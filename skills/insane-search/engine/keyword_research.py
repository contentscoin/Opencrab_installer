#!/usr/bin/env python3
"""Public-source keyword research helper for OpenCrab pack tasks.

This helper is intentionally different from the blocked-URL fetch chain. It
starts with public APIs that are appropriate for keyword-only topics, so a
request like "golf ball" does not accidentally run the URL bypass engine with a
placeholder URL.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


USER_AGENT = "OpenCrabDesktop/1.0 keyword-research"


def _fetch_json(url: str, timeout: int = 15) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - public user-provided research URL
        data = response.read()
    return json.loads(data.decode("utf-8", errors="replace"))


def _source(source_type: str, title: str, url: str, summary: str = "", metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "title": title,
        "url": url,
        "summary": summary,
        "metadata": metadata or {},
    }


def wikipedia_opensearch(query: str, language: str, limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({
        "action": "opensearch",
        "search": query,
        "limit": str(limit),
        "namespace": "0",
        "format": "json",
    })
    url = f"https://{language}.wikipedia.org/w/api.php?{params}"
    try:
        payload = _fetch_json(url)
    except Exception as exc:
        return [_source("wikipedia_error", f"Wikipedia {language} error", url, str(exc))]

    titles = payload[1] if len(payload) > 1 else []
    descriptions = payload[2] if len(payload) > 2 else []
    links = payload[3] if len(payload) > 3 else []
    results = []
    for idx, title in enumerate(titles[:limit]):
        results.append(_source(
            "wikipedia",
            str(title),
            str(links[idx] if idx < len(links) else ""),
            str(descriptions[idx] if idx < len(descriptions) else ""),
            {"language": language},
        ))
    return results


def wikidata_search(query: str, language: str, limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({
        "action": "wbsearchentities",
        "search": query,
        "language": language,
        "uselang": language,
        "format": "json",
        "limit": str(limit),
    })
    url = f"https://www.wikidata.org/w/api.php?{params}"
    try:
        payload = _fetch_json(url)
    except Exception as exc:
        return [_source("wikidata_error", f"Wikidata {language} error", url, str(exc))]

    results = []
    for item in payload.get("search", [])[:limit]:
        entity_id = item.get("id", "")
        results.append(_source(
            "wikidata",
            item.get("label") or entity_id,
            item.get("concepturi") or f"https://www.wikidata.org/wiki/{entity_id}",
            item.get("description") or "",
            {"language": language, "id": entity_id, "aliases": item.get("aliases") or []},
        ))
    return results


def openalex_search(query: str, limit: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"search": query, "per-page": str(limit)})
    url = f"https://api.openalex.org/works?{params}"
    try:
        payload = _fetch_json(url)
    except Exception as exc:
        return [_source("openalex_error", "OpenAlex error", url, str(exc))]

    results = []
    for item in payload.get("results", [])[:limit]:
        title = item.get("title") or item.get("display_name") or item.get("id") or "OpenAlex work"
        landing = item.get("doi") or item.get("id") or ""
        abstract_index = item.get("abstract_inverted_index") or {}
        abstract = ""
        if isinstance(abstract_index, dict):
            words: list[tuple[int, str]] = []
            for word, positions in abstract_index.items():
                for pos in positions or []:
                    words.append((int(pos), str(word)))
            abstract = " ".join(word for _, word in sorted(words)[:80])
        results.append(_source(
            "openalex",
            str(title),
            str(landing),
            abstract,
            {
                "publication_year": item.get("publication_year"),
                "cited_by_count": item.get("cited_by_count"),
                "type": item.get("type"),
            },
        ))
    return results


def dedupe_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output = []
    for source in sources:
        key = (source.get("url") or source.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(source)
    return output


def research(query: str, limit: int = 5) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    for language in ("ko", "en"):
        sources.extend(wikipedia_opensearch(query, language, limit))
        sources.extend(wikidata_search(query, language, limit))
    sources.extend(openalex_search(query, limit))

    return {
        "query": query,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "strategy": "keyword-first public APIs",
        "sources": dedupe_sources(sources),
        "notes": [
            "Use these public-source results as starting evidence.",
            "Run the blocked-URL engine only on concrete source URLs that still need direct page extraction.",
            "Mark weak or missing source coverage explicitly in OpenCrab pack artifacts.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect public-source research results for a keyword topic.")
    parser.add_argument("query", help="Keyword, topic, product, entity, or short user request.")
    parser.add_argument("--limit", type=int, default=5, help="Maximum results per source family.")
    parser.add_argument("--output", "-o", default="", help="Optional JSON output path.")
    parser.add_argument("--json", action="store_true", help="Print JSON to stdout.")
    args = parser.parse_args(argv)

    result = research(args.query, limit=max(1, min(args.limit, 20)))
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json or not args.output:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
