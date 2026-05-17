from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
INSTALL_COMMAND = "python -m pip install multilingual-clip torch open_clip_torch pillow numpy transformers"
DEFAULT_LABELS = [
    "person",
    "face",
    "logo",
    "brand logo",
    "product",
    "product packaging",
    "food",
    "drink",
    "storefront",
    "document",
    "receipt",
    "chart",
    "diagram",
    "screenshot",
    "mobile app screen",
    "website screen",
    "vehicle",
    "building",
    "landscape",
    "fashion item",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rank multilingual labels against images for OpenCrab image pack creation.",
    )
    parser.add_argument("images", nargs="*", help="Image files or directories to scan.")
    parser.add_argument("--image-dir", action="append", default=[], help="Directory to scan recursively for images.")
    parser.add_argument("--labels", help="Text file with one candidate label per line.")
    parser.add_argument("--label", action="append", default=[], help="Candidate label. Can be repeated.")
    parser.add_argument("--output", default="-", help="Output JSONL file. Use '-' for stdout.")
    parser.add_argument("--top-k", type=int, default=5, help="Number of labels to keep per image.")
    parser.add_argument("--model-name", default="M-CLIP/XLM-Roberta-Large-Vit-B-32")
    parser.add_argument("--vision-model", default="ViT-B-32")
    parser.add_argument("--pretrained", default="openai")
    parser.add_argument("--device", default="cpu", help="cpu, cuda, or auto. Defaults to cpu for reliability.")
    parser.add_argument("--print-install-command", action="store_true", help="Print the optional runtime install command and exit.")
    return parser.parse_args()


def iter_image_files(paths: Iterable[str], image_dirs: Iterable[str]) -> list[Path]:
    candidates: list[Path] = []
    all_paths = [Path(item) for item in paths] + [Path(item) for item in image_dirs]
    for path in all_paths:
        if path.is_dir():
            candidates.extend(
                item
                for item in path.rglob("*")
                if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS
            )
        elif path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            candidates.append(path)
    return sorted(dict.fromkeys(item.resolve() for item in candidates))


def load_labels(labels_file: str | None, inline_labels: Iterable[str]) -> list[str]:
    labels: list[str] = []
    if labels_file:
        with Path(labels_file).open("r", encoding="utf-8") as handle:
            labels.extend(line.strip() for line in handle if line.strip() and not line.lstrip().startswith("#"))
    labels.extend(label.strip() for label in inline_labels if label.strip())
    if not labels:
        labels = DEFAULT_LABELS[:]
    return list(dict.fromkeys(labels))


def require_runtime():
    missing: list[str] = []
    modules = {
        "torch": "torch",
        "open_clip": "open_clip_torch",
        "PIL": "pillow",
        "numpy": "numpy",
        "transformers": "transformers",
        "multilingual_clip": "multilingual-clip",
    }
    for module_name, package_name in modules.items():
        try:
            __import__(module_name)
        except ImportError:
            missing.append(package_name)
    if missing:
        raise RuntimeError(
            "Missing vision runtime packages: "
            + ", ".join(sorted(set(missing)))
            + f"\nInstall with: {INSTALL_COMMAND}"
        )


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "visual-concept"


def encode_text_labels(labels: list[str], model_name: str, device: str):
    import torch
    import transformers
    from multilingual_clip import pt_multilingual_clip

    text_model = pt_multilingual_clip.MultilingualCLIP.from_pretrained(model_name)
    tokenizer = transformers.AutoTokenizer.from_pretrained(model_name)
    text_model.to(device)
    text_model.eval()
    with torch.no_grad():
        tokens = tokenizer(labels, padding=True, return_tensors="pt")
        tokens = {key: value.to(device) for key, value in tokens.items()}
        embeddings = text_model.transformer(**tokens)[0]
        attention = tokens["attention_mask"]
        embeddings = (embeddings * attention.unsqueeze(2)).sum(dim=1) / attention.sum(dim=1)[:, None]
        embeddings = text_model.LinearTransformation(embeddings)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True).clamp(min=1e-12)
    return embeddings


def create_image_encoder(vision_model: str, pretrained: str, device: str):
    import open_clip

    model, _, preprocess = open_clip.create_model_and_transforms(vision_model, pretrained=pretrained)
    model.to(device)
    model.eval()
    return model, preprocess


def choose_device(requested: str) -> str:
    if requested == "auto":
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    return requested


def rank_images(args: argparse.Namespace, image_paths: list[Path], labels: list[str]) -> list[dict]:
    require_runtime()

    import torch
    from PIL import Image

    device = choose_device(args.device)
    text_embeddings = encode_text_labels(labels, args.model_name, device)
    image_model, preprocess = create_image_encoder(args.vision_model, args.pretrained, device)

    records: list[dict] = []
    for image_path in image_paths:
        with Image.open(image_path) as image:
            tensor = preprocess(image.convert("RGB")).unsqueeze(0).to(device)
        with torch.no_grad():
            image_embedding = image_model.encode_image(tensor)
            image_embedding = image_embedding / image_embedding.norm(dim=-1, keepdim=True).clamp(min=1e-12)
            scores = (image_embedding @ text_embeddings.T).squeeze(0).detach().cpu().tolist()

        ranked = sorted(zip(labels, scores), key=lambda item: item[1], reverse=True)[: max(args.top_k, 1)]
        top_labels = [{"label": label, "score": round(float(score), 6)} for label, score in ranked]
        image_id = f"image-{slugify(image_path.stem)}"
        record = {
            "type": "image_asset",
            "image_id": image_id,
            "image_path": str(image_path),
            "model": {
                "text_encoder": args.model_name,
                "vision_encoder": args.vision_model,
                "pretrained": args.pretrained,
                "device": device,
            },
            "top_labels": top_labels,
            "suggested_nodes": [
                {
                    "id": f"visual-concept-{slugify(item['label'])}",
                    "type": "VisualConcept",
                    "name": item["label"],
                    "confidence": item["score"],
                }
                for item in top_labels
            ],
            "suggested_edges": [
                {
                    "source": image_id,
                    "target": f"visual-concept-{slugify(item['label'])}",
                    "type": "visually_matches",
                    "confidence": item["score"],
                }
                for item in top_labels
            ],
        }
        records.append(record)
    return records


def write_jsonl(records: list[dict], output: str) -> None:
    lines = [json.dumps(record, ensure_ascii=False) for record in records]
    if output == "-":
        for line in lines:
            print(line)
        return
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for line in lines:
            handle.write(line + "\n")


def main() -> int:
    args = parse_args()
    if args.print_install_command:
        print(INSTALL_COMMAND)
        return 0

    image_paths = iter_image_files(args.images, args.image_dir)
    if not image_paths:
        print("No image files found.", file=sys.stderr)
        return 2
    labels = load_labels(args.labels, args.label)

    try:
        records = rank_images(args, image_paths, labels)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 3

    write_jsonl(records, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
