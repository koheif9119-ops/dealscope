# -*- coding: utf-8 -*-
"""共通ユーティリティ（HTTP取得・JSON入出力・パス定義）。

アクセスマナー（仕様書2-5）:
- リクエスト間隔は1秒以上あける
- リトライは最大2回、指数バックオフ
- User-Agentに連絡先（リポジトリURL）を含める
"""
import json
import os
import time
import urllib.request
from datetime import timedelta, timezone

JST = timezone(timedelta(hours=9))

USER_AGENT = "DealScope/1.0 (+https://github.com/koheif9119-ops/dealscope)"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
DAILY_DIR = os.path.join(DATA_DIR, "daily")
MASTER_PATH = os.path.join(DATA_DIR, "master", "markets.json")
LATEST_PATH = os.path.join(DATA_DIR, "latest.json")
CONFIG_PATH = os.path.join(ROOT, "config", "keywords.json")

_last_request_at = 0.0


def polite_get(url, timeout=60):
    """1秒以上の間隔を空けてURLを取得する。失敗時は2秒→4秒の間隔で最大2回リトライ。"""
    global _last_request_at
    last_err = None
    for attempt in range(3):  # 初回 + リトライ2回
        wait = _last_request_at + 1.0 - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
            _last_request_at = time.time()
            return body
        except Exception as e:  # noqa: BLE001
            _last_request_at = time.time()
            last_err = e
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
    raise last_err


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj, sort_keys=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=sort_keys)
        f.write("\n")
