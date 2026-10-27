#!/usr/bin/env python3
"""把 WB01 的 npz 权重导出成前端/Worker 可直接加载的 TS 模块。

用法：
    python scripts/prepare-wb01-model.py <解压后的 wb01_api 目录> <输出 ts 路径>

导出内容与 npz 一一对应：w(8192 float32)、idf(8192 float32)、b、D、version。
推理公式见 lib/core/wb01.ts，必须与 wb01_api/app.py 的 featurize/predict_one 等价。
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()

    npz_path = src / "model" / "wb01_textonly_model.npz"
    info_path = src / "model" / "wb01_textonly_model_info.json"
    model = np.load(npz_path)

    w = model["w"].astype("<f4")
    idf = model["idf"].astype("<f4")
    b = float(model["b"])
    dim = int(model["D"])
    version = str(model["version"][0])

    assert w.shape == (dim,) and idf.shape == (dim,), "权重维度与 D 不一致"

    info = json.loads(info_path.read_text(encoding="utf-8")) if info_path.exists() else {}
    info.pop("train_metrics_sanity", None)

    body = f'''// 由 scripts/prepare-wb01-model.py 生成,请勿手工编辑。
// 来源:{npz_path.name} / {info_path.name}
// 维度 {dim},版本 {version};w 与 idf 以 float32 小端序列 base64 存储。
export const WB01_DIM = {dim};
export const WB01_VERSION = {json.dumps(version, ensure_ascii=False)};
export const WB01_BIAS = {b!r};
export const WB01_INFO = {json.dumps(info, ensure_ascii=False, indent=2)} as const;
export const WB01_W_B64 = "{base64.b64encode(w.tobytes()).decode()}";
export const WB01_IDF_B64 = "{base64.b64encode(idf.tobytes()).decode()}";
'''
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    print(f"已写入 {out} ({len(body)} 字节),维度 {dim},版本 {version},b={b:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
