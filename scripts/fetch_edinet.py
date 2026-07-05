# -*- coding: utf-8 -*-
"""EDINET API v2 で有価証券報告書（訂正含む）を取得する。

APIキーは環境変数 EDINET_API_KEY（GitHub ActionsのSecrets）から渡される。
"""
import json
import urllib.parse

from util import polite_get

API = "https://api.edinet-fsa.go.jp/api/v2/documents.json?date={date}&type=2&Subscription-Key={key}"
VIEWER = "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?{doc_id}"

# docTypeCode: 120=有価証券報告書, 130=訂正有価証券報告書
TARGET_DOC_TYPES = {"120", "130"}


def fetch_day(date_iso, api_key):
    """指定日（YYYY-MM-DD）の提出書類のうち有報・訂正有報を返す。"""
    url = API.format(date=date_iso, key=urllib.parse.quote(api_key))
    body = polite_get(url)
    data = json.loads(body)
    results = data.get("results") or []
    rows = []
    for r in results:
        if r.get("docTypeCode") not in TARGET_DOC_TYPES:
            continue
        sec = str(r.get("secCode") or "").strip()
        if not sec:
            continue  # 証券コードなし（非上場ファンド等）は対象外
        code = sec[:4] if len(sec) == 5 else sec

        submit = (r.get("submitDateTime") or "").strip()  # 例: "2026-07-03 11:30"
        if len(submit) < 16:
            continue
        doc_id = str(r.get("docID") or "")

        rows.append({
            "id": "edinet-" + doc_id,
            "date": submit[:10],
            "time": submit[11:16],
            "code": code,
            "name": (r.get("filerName") or "").strip(),
            "exch": "—",  # 取引所はEDINETからは取れないため市場区分マスタで補完
            "title": (r.get("docDescription") or "有価証券報告書").strip(),
            "pdfUrl": VIEWER.format(doc_id=doc_id),
            "src": "EDINET",
        })
    return rows
