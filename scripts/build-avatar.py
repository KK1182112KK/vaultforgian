from __future__ import annotations

import argparse
import base64
import hashlib
import os
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Pillow is required to build the assistant avatar. Install it in the Python environment used for this command.") from exc


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_IMAGE = PROJECT_ROOT / "assets" / "chat-avatar-source.png"
DEFAULT_OUTPUT_FILE = PROJECT_ROOT / "src" / "generated" / "chatAvatar.ts"
OUTPUT_SIZE = 96
WHITE_THRESHOLD = 245
PADDING = 8
FINAL_PADDING = 4


def make_white_background_transparent(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a <= 10:
                continue
            if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD:
                pixels[x, y] = (r, g, b, 0)
    return rgba


def crop_logo(image: Image.Image) -> Image.Image:
    rgba = make_white_background_transparent(image)
    pixels = rgba.load()
    min_x, min_y = rgba.width, rgba.height
    max_x = max_y = -1

    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a <= 10:
                continue
            if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    if max_x < min_x or max_y < min_y:
        return rgba

    min_x = max(0, min_x - PADDING)
    min_y = max(0, min_y - PADDING)
    max_x = min(rgba.width, max_x + PADDING + 1)
    max_y = min(rgba.height, max_y + PADDING + 1)
    return rgba.crop((min_x, min_y, max_x, max_y))


def trim_transparent_bounds(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value > 10 else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        return rgba
    return rgba.crop(bbox)


def center_on_square_canvas(image: Image.Image) -> Image.Image:
    trimmed = trim_transparent_bounds(image)
    target_inner = OUTPUT_SIZE - (FINAL_PADDING * 2)
    width, height = trimmed.size
    if width <= 0 or height <= 0:
        return Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    scale = min(target_inner / width, target_inner / height)
    resized = trimmed.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    )
    resized = trim_transparent_bounds(resized)
    canvas = Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    offset_x = (OUTPUT_SIZE - resized.width) // 2
    offset_y = (OUTPUT_SIZE - resized.height) // 2
    canvas.alpha_composite(resized, (offset_x, offset_y))
    return canvas


def resolve_project_path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate


def project_relative(target: Path) -> str:
    try:
        return target.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(target)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the tracked assistant avatar module.")
    parser.add_argument("--source", help="Avatar source image path (absolute or relative to the repo root).")
    parser.add_argument("--output", help="Generated TypeScript output path (absolute or relative to the repo root).")
    return parser.parse_args()


def build_avatar_data_url(source_image: Path) -> str:
    with Image.open(source_image) as source:
        cropped = crop_logo(source)
        fitted = ImageOps.fit(cropped, (OUTPUT_SIZE, OUTPUT_SIZE), method=Image.Resampling.LANCZOS)
        balanced = center_on_square_canvas(fitted)
    output = BytesIO()
    balanced.save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def compute_source_hash(source_image: Path) -> str:
    return hashlib.sha256(source_image.read_bytes()).hexdigest()


def main() -> None:
    args = parse_args()
    source_image = resolve_project_path(args.source or os.environ.get("CODEX_NOTEFORGE_AVATAR_SOURCE"), DEFAULT_SOURCE_IMAGE)
    output_file = resolve_project_path(args.output, DEFAULT_OUTPUT_FILE)
    if not source_image.is_file():
        raise SystemExit(f"Avatar source not found: {project_relative(source_image)}")

    output_file.parent.mkdir(parents=True, exist_ok=True)
    source_hash = compute_source_hash(source_image)
    data_url = build_avatar_data_url(source_image)
    output_file.write_text(
        "\n".join(
            [
                "// Generated by scripts/build-avatar.py",
                f"// Source image SHA-256: {source_hash}",
                f"export const CHAT_AVATAR_DATA_URL = {data_url!r} as const;",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"Built {project_relative(output_file)} from {project_relative(source_image)}")


if __name__ == "__main__":
    main()
