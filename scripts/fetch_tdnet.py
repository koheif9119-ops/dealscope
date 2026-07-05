# -*- coding: utf-8 -*-
"""TDnet適時開示の取得。

yanoshin TDnet WebAPI（https://webapi.yanoshin.jp/tdnet/）を利用する。
※ TDnet閲覧サービス本体はrobots.txtで自動アクセス不許可のため直接触らない（仕様書2-1）。
   有報キャッチャーのAtomフィードは2026年7月時点で404（提供終了とみられる）ため不採用。
"""
import json

from util import polite_get

API = "https://webapi.yanoshin.jp/webapi/tdnet/list/{date}.json?limit=5000"


def _to_direct_url(url):
    """yanoshinのリダイレクタ（rd.php?...）を挟んだURLから直接のPDF URLを取り出す。"""
    if url and "rd.php?" in url:
        return url.split("rd.php?", 1)[1]
    return url or ""


def fetch_day(yyyymmdd):
    """指定日（YYYYMMDD）の全開示を取得し、共通形式の辞書リストで返す。"""
    body = polite_get(API.format(date=yyyymmdd))
    data = json.loads(body)
    rows = []
    for entry in data.get("items", []):
        t = entry.get("Tdnet", entry)
        pubdate = (t.get("pubdate") or "").strip()  # 例: "2026-07-03 19:20:00"
        if len(pubdate) < 16:
            continue
        date = pubdate[:10]
        hm = pubdate[11:16]

        code5 = str(t.get("company_code") or "").strip()
        code = code5[:4] if len(code5) == 5 else (code5 or "—")

        markets = str(t.get("markets_string") or "")
        if "東" in markets:
            exch = "東"
        elif markets:
            exch = markets[0]
        else:
            exch = "—"

        rows.append({
            "id": "tdnet-" + str(t.get("id") or ""),
            "date": date,
            "time": hm,
            "code": code,
            "name": (t.get("company_name") or "").strip(),
            "exch": exch,
            "title": (t.get("title") or "").strip(),
            "pdfUrl": _to_direct_url(t.get("document_url")),
            "src": "TDnet",
            "hasXbrl": bool(t.get("url_xbrl")),
        })
    return rows
