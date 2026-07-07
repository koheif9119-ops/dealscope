# -*- coding: utf-8 -*-
"""証券コード→法人番号・正式社名の対照表（data/master/jcn.json）を作る。

情報源はEDINETが公開している「EDINETコードリスト」（無料・全提出者分）。
月1回更新すれば十分（master.ymlから実行。無ければ定期取得時にも作られる）。
"""
import csv
import io
import os
import zipfile

from util import DATA_DIR, polite_get, write_json

URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"
JCN_PATH = os.path.join(DATA_DIR, "master", "jcn.json")


def main():
    z = zipfile.ZipFile(io.BytesIO(polite_get(URL, timeout=120)))
    csv_name = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
    text = z.read(csv_name).decode("cp932", "replace")
    rows = list(csv.reader(io.StringIO(text)))
    # 1行目はダウンロード日などのメタ情報、2行目が見出し
    header = rows[1]
    i_name = header.index("提出者名")
    i_sec = header.index("証券コード")
    i_jcn = header.index("提出者法人番号")

    out = {}
    for r in rows[2:]:
        if len(r) <= max(i_name, i_sec, i_jcn):
            continue
        sec = r[i_sec].strip()
        if not sec:
            continue  # 証券コードなし（非上場）は対象外
        code = sec[:4] if len(sec) == 5 else sec
        out[code] = {"jcn": r[i_jcn].strip(), "name": r[i_name].strip()}

    write_json(JCN_PATH, out, sort_keys=True)
    print(f"法人番号マスタを更新しました（{len(out)}社）")


if __name__ == "__main__":
    main()
