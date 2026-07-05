# -*- coding: utf-8 -*-
"""PR TIMESのRSSフィードからM&A関連記事を取得する。

キーワード別RSSは提供が確認できないため（2026年7月時点）、
全体フィードを取得し、タイトル・概要にキーワードが含まれる記事だけを採用する（仕様書2-3）。
"""
import calendar
import hashlib
from datetime import datetime

import feedparser

from util import JST, polite_get

FEED = "https://prtimes.jp/index.rdf"


def fetch(keywords):
    body = polite_get(FEED)
    feed = feedparser.parse(body)
    rows = []
    for e in feed.entries:
        title = (e.get("title") or "").strip()
        summary = e.get("summary") or ""
        text = (title + " " + summary).lower()
        hit = [k for k in keywords if k.lower() in text]
        if not hit:
            continue

        tm = e.get("published_parsed") or e.get("updated_parsed")
        if not tm:
            continue
        dt = datetime.fromtimestamp(calendar.timegm(tm), JST)

        link = e.get("link") or ""
        rows.append({
            "id": "prtimes-" + hashlib.sha1(link.encode("utf-8")).hexdigest()[:12],
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "code": "—",
            "name": "PR TIMES掲載",
            "market": "—",
            "exch": "—",
            "genre": "news",
            "tags": hit[:3],
            "title": title,
            "pdfUrl": link,
            "src": "PR TIMES",
        })
    return rows
