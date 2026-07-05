# -*- coding: utf-8 -*-
"""表題キーワードによる分類（仕様書3）と市場区分の付与（仕様書2-4）。

キーワードは config/keywords.json に外出ししてあり、コードを触らず編集できる。
"""
from util import CONFIG_PATH, read_json

# 上から順に評価し、最初に一致したジャンルを採用する
GENRE_PRIORITY = ["ma", "chukei", "kessan"]


def load_keywords():
    return read_json(CONFIG_PATH, {})


def classify_title(title, keywords):
    """表題からジャンルと一致キーワード（tags）を返す。どれにも該当しなければ (None, [])。"""
    for genre in GENRE_PRIORITY:
        tags = [k for k in keywords.get(genre, []) if k in title]
        if tags:
            return genre, tags
    tags = [k for k in keywords.get("release", []) if k in title]
    if tags:
        return "release", tags
    return None, []


def resolve_market(item, master):
    """市場区分（プライム／スタンダード／グロース／地方／不明）を付与する。

    - JPXマスタにあるコード → マスタの市場区分（東証）
    - マスタになく、取引所が名・札・福 → 「地方」
    - それ以外 → 「不明」（欠落で開示は落とさない）
    """
    if item.get("src") == "PR TIMES":
        item["market"] = "—"
        return
    info = master.get(item.get("code", ""))
    if info:
        item["market"] = info["market"]
        if item.get("exch") in (None, "", "—"):
            item["exch"] = info.get("exch", "東")
    elif item.get("exch") in ("名", "札", "福"):
        item["market"] = "地方"
    else:
        item["market"] = "不明"
        if not item.get("exch"):
            item["exch"] = "—"
