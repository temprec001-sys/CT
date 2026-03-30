from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from PIL import Image
from pydicom.multival import MultiValue


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = Path("L:\\")
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the local DICOM slice web viewer.")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="Mounted ISO source root, default: L:\\")
    parser.add_argument("--out", default=str(DEFAULT_DATA_DIR), help="Output data directory")
    return parser.parse_args()


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, MultiValue)):
        value = value[0] if value else ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        if isinstance(value, (list, tuple, MultiValue)):
            value = value[0] if value else None
        return int(float(str(value).strip()))
    except Exception:
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, (list, tuple, MultiValue)):
            value = value[0] if value else None
        return float(str(value).strip())
    except Exception:
        return default


def first_number(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, (list, tuple, MultiValue)):
        value = value[0] if value else None
    if value is None:
        return default
    try:
        return float(str(value).strip())
    except Exception:
        return default


def slugify(value: str, fallback: str = "series") -> str:
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or fallback


def file_id_to_path(source_root: Path, referenced_file_id: Any) -> Path:
    if isinstance(referenced_file_id, (list, tuple, MultiValue)):
        parts = [str(part) for part in referenced_file_id]
        return source_root.joinpath(*parts)
    return source_root / str(referenced_file_id)


def dicom_sort_key(ds: pydicom.dataset.Dataset, fallback_index: int) -> tuple[float, float, int]:
    in_stack = ds.get("InStackPositionNumber")
    if in_stack is not None:
        return (0.0, safe_float(in_stack, fallback_index), fallback_index)

    position = ds.get("ImagePositionPatient")
    orientation = ds.get("ImageOrientationPatient")
    if position is not None and orientation is not None:
        try:
            pos = np.asarray([safe_float(v) for v in position], dtype=np.float64)
            orient = np.asarray([safe_float(v) for v in orientation], dtype=np.float64)
            normal = np.cross(orient[:3], orient[3:6])
            projected = float(np.dot(pos, normal))
            return (1.0, projected, fallback_index)
        except Exception:
            pass

    instance = ds.get("InstanceNumber")
    if instance is not None:
        return (2.0, safe_float(instance, fallback_index), fallback_index)

    return (3.0, float(fallback_index), fallback_index)


def window_to_uint8(arr: np.ndarray, ds: pydicom.dataset.Dataset) -> np.ndarray:
    data = arr.astype(np.float32)
    slope = safe_float(ds.get("RescaleSlope"), 1.0)
    intercept = safe_float(ds.get("RescaleIntercept"), 0.0)
    data = data * slope + intercept

    center = first_number(ds.get("WindowCenter"))
    width = first_number(ds.get("WindowWidth"))
    if center is None or width is None or width <= 1:
        lo, hi = np.percentile(data, [0.5, 99.5])
    else:
        lo = center - (width / 2.0)
        hi = center + (width / 2.0)

    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        lo = float(np.min(data))
        hi = float(np.max(data))
        if hi <= lo:
            hi = lo + 1.0

    data = np.clip((data - lo) / (hi - lo), 0.0, 1.0)
    data = (data * 255.0).round().astype(np.uint8)

    if normalize_text(ds.get("PhotometricInterpretation")).upper() == "MONOCHROME1":
        data = 255 - data

    return data


def series_label(ds: pydicom.dataset.Dataset) -> str:
    desc = normalize_text(ds.get("SeriesDescription"))
    protocol = normalize_text(ds.get("ProtocolName"))
    if desc and protocol and desc.lower() not in protocol.lower():
        return f"{desc} · {protocol}"
    return desc or protocol or f"Series {normalize_text(ds.get('SeriesNumber')) or '?'}"


def build_manifest(source_root: Path) -> dict[str, Any]:
    dicomdir_path = source_root / "DICOMDIR"
    if not dicomdir_path.exists():
        raise FileNotFoundError(f"Missing DICOMDIR: {dicomdir_path}")

    dicomdir = pydicom.dcmread(str(dicomdir_path), force=True)
    groups: list[dict[str, Any]] = []
    current_group: dict[str, Any] | None = None

    for record in dicomdir.DirectoryRecordSequence:
        record_type = normalize_text(record.get("DirectoryRecordType")).upper()
        if record_type == "SERIES":
            current_group = {"image_refs": []}
            groups.append(current_group)
        elif record_type == "IMAGE" and current_group is not None:
            current_group["image_refs"].append(record.ReferencedFileID)

    included_series: list[dict[str, Any]] = []
    excluded_series: list[dict[str, Any]] = []

    for group_index, group in enumerate(groups, start=1):
        refs = group["image_refs"]
        if not refs:
            continue

        first_path = file_id_to_path(source_root, refs[0])
        first_ds = pydicom.dcmread(str(first_path), stop_before_pixels=True, force=True)
        modality = normalize_text(first_ds.get("Modality")).upper()
        frame_count = safe_int(first_ds.get("NumberOfFrames"), 1)

        if modality != "CT" or frame_count > 1:
            excluded_series.append(
                {
                    "groupIndex": group_index,
                    "modality": modality or "UNKNOWN",
                    "frameCount": frame_count,
                    "imageCount": len(refs),
                    "reason": "multi-frame cine or non-CT series",
                }
            )
            continue

        image_refs: list[dict[str, Any]] = []
        for file_index, ref in enumerate(refs, start=1):
            path = file_id_to_path(source_root, ref)
            header = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
            if safe_int(header.get("NumberOfFrames"), 1) > 1:
                continue
            image_refs.append(
                {
                    "path": path,
                    "header": header,
                    "sort_key": dicom_sort_key(header, file_index),
                }
            )

        if not image_refs:
            continue

        image_refs.sort(key=lambda item: item["sort_key"])
        sample_ds = image_refs[0]["header"]

        series_number = safe_int(sample_ds.get("SeriesNumber"), group_index)
        title = series_label(sample_ds)
        protocol = normalize_text(sample_ds.get("ProtocolName"))
        rows = safe_int(sample_ds.get("Rows"))
        cols = safe_int(sample_ds.get("Columns"))
        slice_thickness = safe_float(sample_ds.get("SliceThickness"), 0.0) or None
        pixel_spacing = [safe_float(v) for v in (sample_ds.get("PixelSpacing") or [])][:2]
        if len(pixel_spacing) != 2:
          pixel_spacing = []

        wc = first_number(sample_ds.get("WindowCenter"))
        ww = first_number(sample_ds.get("WindowWidth"))
        orientation = [safe_float(v) for v in (sample_ds.get("ImageOrientationPatient") or [])][:6]
        position = [safe_float(v) for v in (sample_ds.get("ImagePositionPatient") or [])][:3]

        included_series.append(
            {
                "groupIndex": group_index,
                "modality": modality,
                "seriesNumber": series_number,
                "title": title,
                "protocol": protocol,
                "rows": rows,
                "columns": cols,
                "sliceThickness": slice_thickness,
                "pixelSpacing": pixel_spacing,
                "windowCenter": wc,
                "windowWidth": ww,
                "orientation": orientation,
                "position": position,
                "imageRefs": image_refs,
                "imageCount": len(image_refs),
            }
        )

    included_series.sort(
        key=lambda item: (
            -item["imageCount"],
            item["seriesNumber"],
            item["groupIndex"],
        )
    )

    return {
        "source": {
            "path": str(source_root),
            "dicomdir": str(dicomdir_path),
        },
        "series": included_series,
        "excludedSeries": excluded_series,
    }


def write_png_slice(ds: pydicom.dataset.Dataset, out_path: Path) -> dict[str, Any]:
    arr = ds.pixel_array
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        image = Image.fromarray(np.ascontiguousarray(arr))
        image.save(out_path, optimize=False, compress_level=6)
        return {"mode": "color", "shape": list(arr.shape)}

    if arr.ndim > 2:
        arr = np.squeeze(arr)

    display = window_to_uint8(arr, ds)
    image = Image.fromarray(display)
    image.save(out_path, optimize=False, compress_level=6)
    return {"mode": "grayscale", "shape": list(arr.shape)}


def build_data(source_root: Path, out_root: Path) -> dict[str, Any]:
    if out_root.exists():
        shutil.rmtree(out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    manifest = build_manifest(source_root)
    series_payload: list[dict[str, Any]] = []
    total_slices = 0

    for series_index, item in enumerate(manifest["series"], start=1):
        title_slug = slugify(item["title"])
        protocol_slug = slugify(item["protocol"], fallback="ct")
        series_slug = f"series-{series_index:02d}-{title_slug}"
        if protocol_slug and protocol_slug not in series_slug:
            series_slug = f"{series_slug}-{protocol_slug}"

        series_dir = out_root / series_slug
        series_dir.mkdir(parents=True, exist_ok=True)

        digits = max(4, len(str(item["imageCount"])))
        slice_files: list[str] = []
        sample_shape = None

        for slice_index, image_info in enumerate(item["imageRefs"], start=1):
            ds = pydicom.dcmread(str(image_info["path"]), force=True)
            slice_name = f"{slice_index:0{digits}d}.png"
            out_path = series_dir / slice_name
            image_meta = write_png_slice(ds, out_path)
            if sample_shape is None:
                sample_shape = image_meta["shape"]
            slice_files.append(slice_name)
            total_slices += 1
            if slice_index % 50 == 0 or slice_index == item["imageCount"]:
                print(f"[{series_index}/{len(manifest['series'])}] {item['title']}: {slice_index}/{item['imageCount']}")

        series_payload.append(
            {
                "id": series_slug,
                "order": series_index,
                "modality": item["modality"],
                "seriesNumber": item["seriesNumber"],
                "title": item["title"],
                "protocol": item["protocol"],
                "imageCount": item["imageCount"],
                "rows": item["rows"],
                "columns": item["columns"],
                "sliceThickness": item["sliceThickness"],
                "pixelSpacing": item["pixelSpacing"],
                "windowCenter": item["windowCenter"],
                "windowWidth": item["windowWidth"],
                "orientation": item["orientation"],
                "position": item["position"],
                "imageDir": f"data/{series_slug}",
                "slices": slice_files,
                "sampleShape": sample_shape,
            }
        )

    preferred = next(
        (series["id"] for series in series_payload if "SOFT BODY 1.0" in series["title"].upper()),
        series_payload[0]["id"] if series_payload else None,
    )

    manifest_payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "defaultSeriesId": preferred,
        "series": series_payload,
        "excludedSeries": manifest["excludedSeries"],
        "summary": {
            "seriesCount": len(series_payload),
            "sliceCount": total_slices,
            "excludedCount": len(manifest["excludedSeries"]),
        },
    }

    payload_text = json.dumps(manifest_payload, ensure_ascii=False, indent=2)
    (out_root / "manifest.json").write_text(payload_text, encoding="utf-8")
    (out_root / "manifest.js").write_text(f"window.SLICE_MANIFEST = {payload_text};\n", encoding="utf-8")

    return manifest_payload


def main() -> None:
    args = parse_args()
    source_root = Path(args.source).expanduser()
    out_root = Path(args.out).expanduser()
    manifest = build_data(source_root, out_root)
    print(f"Built {manifest['summary']['seriesCount']} CT series and {manifest['summary']['sliceCount']} slices")
    print(f"Manifest: {out_root / 'manifest.js'}")


if __name__ == "__main__":
    main()
