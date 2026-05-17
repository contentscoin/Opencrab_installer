---
name: multilingual-clip-vision
description: Use when creating OpenCrab ontology or marketplace packs from image datasets, multilingual image labels, product/package imagery, screenshots, or visual asset folders.
---

# Multilingual CLIP Vision Packs

Use this skill when an OpenCrab task involves image data analysis or building a reusable ontology/marketplace pack from image assets.

This skill integrates the Multilingual-CLIP approach from `FreddeFrallan/Multilingual-CLIP`: multilingual text labels are embedded into the same space as CLIP image embeddings, then ranked against image embeddings produced by a compatible CLIP/OpenCLIP vision encoder.

Important: Multilingual-CLIP is not an image captioning model by itself. It is a multilingual text encoder aligned to CLIP vision embeddings. Use image similarity scores as candidate evidence, then confirm with filenames, directory context, OCR, source metadata, captions, nearby text, or user-provided taxonomy.

## Recommended Workflow

1. Collect image files and preserve provenance:
   - original path or URL
   - dataset/source name
   - creator/license if known
   - any caption, alt text, filename, folder, or page context
2. Build a candidate label file in the target language(s). Prefer domain-specific labels over generic tags.
3. Run the helper engine from this skill directory.
4. Review top label matches and confidence scores. Treat them as retrieval signals, not final truth.
5. Convert the results into OpenCrab pack artifacts:
   - `ImageAsset` nodes for files/URLs
   - `VisualConcept` nodes for labels/classes
   - `Source` nodes for dataset, page, or collection provenance
   - edges such as `depicts`, `visually_matches`, `belongs_to_pack`, `sourced_from`
6. Write outputs under `opencrab_data/vision` or `opencrab_data/ingest` as JSONL, CSV, Markdown, or Cypher.

## Runtime Setup

The desktop installer does not bundle the heavy vision runtime by default so normal installation stays fast. Install the runtime only when image pack work is needed:

```bash
python -m pip install multilingual-clip torch open_clip_torch pillow numpy transformers
```

In OpenCrab Desktop packaged installs, use the Python command shown in the Codex task context. It normally points to the writable bundled runtime.

To include these heavy dependencies during installer builds, set:

```bash
OPENCRAB_INSTALL_VISION_DEPS=1
```

## Helper Engine

From this skill directory:

```bash
python -m engine --image-dir ./images --labels labels.txt --output opencrab_data/vision/image-pack.jsonl --top-k 5
```

Useful options:

- `--image-dir <dir>`: recursively scan a folder for image files
- `--labels <file>`: one candidate label per line
- `--label <text>`: add a label from the command line
- `--output <file>`: write JSONL records
- `--model-name`: default `M-CLIP/XLM-Roberta-Large-Vit-B-32`
- `--vision-model`: default `ViT-B-32`
- `--pretrained`: default `openai`
- `--device`: default `cpu`

## Output Shape

The engine writes one JSON object per image:

```json
{
  "type": "image_asset",
  "image_path": "assets/example.jpg",
  "top_labels": [
    { "label": "product packaging", "score": 0.284 }
  ],
  "suggested_nodes": [],
  "suggested_edges": []
}
```

Use `top_labels` to create candidate ontology concepts and pack metadata. Keep the original image provenance in the final pack so later graph/RAG answers can cite where each visual assertion came from.

## Safety And Evidence

- Do not process private, login-only, or copyrighted datasets unless the user has permission.
- Do not identify private people or make sensitive biometric claims from images.
- Do not treat similarity scores as proof. Use them to rank candidates, then corroborate with source evidence.
- For marketplace packs, include licensing and source notes for every image collection.

## References

- Multilingual-CLIP: https://github.com/FreddeFrallan/Multilingual-CLIP
- Model hub: https://huggingface.co/M-CLIP
- OpenCLIP: https://github.com/mlfoundations/open_clip
