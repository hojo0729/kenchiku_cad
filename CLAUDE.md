# 建築CAD（kenchiku_cad）

勉強用に作る、建築に特化した2D CAD。PCとタブレットのブラウザで動くWebアプリ（将来PWA化）。
最終的に **JWW / DXF / DWG** で書き出せることを目標にする。

> このリポジトリは claude.ai のチャットと Claude Code の両方から作業する。
> **作業の最後に必ずこのファイルの「進捗」「次にやること」を更新してからコミット・push する。**
> 作業を始める前は `git pull` してから、このファイルを読んで現状を把握する。

## 方針

- **内部データは「建築部材」で持つ**（通り芯・壁・開口・柱・部屋・寸法）。書き出し時に線・円弧・文字へ分解する。
  今は土台として `line` だけ。部材を追加しても既存の書き出しを壊さない構造にする。
- 単位は **mm**、座標系は **Y軸上向き**（DXF/Jw_cadと同じ）。画面表示時だけ反転する（`src/viewport.ts`）。
- 出力形式
  - **DXF**: R12 (AC1009) ASCII を自前で生成（`src/export/dxf.ts`）。互換性最優先。
    日本語（画層名・文字）は R12 では Shift_JIS 前提 → 文字実装時にエンコード対応が必要。
  - **JWW**: Jw_cad 作者が公開している JWW ファイル形式仕様（MFC CArchive 形式のバイナリ）を元に自作予定。
    ブラウザ内で `DataView` を使って生成する。参考: jwwlib（OSS）。
  - **DWG**: 自前生成はしない。DXF を出力し、PC 上の **ODA File Converter** で DWG に変換する運用。
    （タブレットでは不可。必要になったら変換サーバーを検討）
- 入力は **Pointer Events** で統一（マウス・ペン・指）。
  - 1本指/左ドラッグ = パン、タップ/クリック = 点を置く、2本指 = ピンチズーム＋パン、ホイール = ズーム
  - タッチはスナップ半径を広く（28px、マウスは12px）
  - ボタンは最低 44px。右クリックやショートカットがなくても全操作できるようにする
- 依存は最小限。UIフレームワークなし（素の TypeScript + Canvas 2D）。必要になったら検討。

## 技術構成

- Vite + TypeScript（strict）、Canvas 2D、テストは Vitest
- 保存: 今は localStorage に自動保存（`kenchiku-cad:drawing`）。将来 IndexedDB ＋ファイル書き出し。
- iPad Safari はファイルの上書き保存ができないため、保存はダウンロード形式を基本にする。

## ディレクトリ

```
src/
  main.ts          アプリ本体（状態・入力・ツールバー）
  model.ts         図面データモデル（Drawing / Entity / Layer）
  viewport.ts      ワールド⇔スクリーン変換、ズーム・パン
  snap.ts          スナップ（端点 > グリッド）
  renderer.ts      Canvas 描画（グリッド・図形・プレビュー・スナップ表示）
  export/dxf.ts    DXF R12 書き出し
  style.css        UI（ライト/ダーク対応、CSS変数）
```

## コマンド

```
npm install
npm run dev        # 開発サーバー（--host 付きなので同じLANのタブレットからも開ける）
npm test           # テスト
npm run build      # 型チェック＋ビルド
```

## 進捗

- [x] Phase 1: 最小CAD
  - [x] 線（連続線）作図、端点スナップ、グリッドスナップ（910/455/100/なし）
  - [x] パン・ズーム（マウスホイール、ピンチ、ドラッグ）、全体表示
  - [x] 元に戻す、全消去、localStorage 自動保存
  - [x] DXF(R12) 書き出し
- [ ] Phase 2: 通り芯と壁（芯＋厚み）、壁の交差部（L・T・十字）の処理
- [ ] Phase 3: ドア・窓を壁に挿入（壁を自動で切り欠く）
- [ ] Phase 4: 寸法線・文字（DXFの Shift_JIS 対応含む）、画層管理、縮尺・用紙枠
- [ ] Phase 5: JWW 書き出し（Jw_cad で開いて確認）
- [ ] Phase 6: DWG（ODA File Converter 手順の整備）、PWA 化

## 次にやること

1. 実機確認: 修正後の DXF が Jw_cad で開けるか確認中（test_A=自前出力 / test_B=ezdxf出力 で比較）
2. 選択・削除ツール（線をタップで選択、削除）
3. 直交モード（水平・垂直に固定）と数値入力（長さを打ち込む）
4. Phase 2 の設計: `Wall { a, b, thickness, layer }` と `GridLine` をモデルに追加

## メモ・決定事項

- 2026-10-14: プロジェクト開始。Web（Vite+TS+Canvas）で PC＋タブレット対応に決定。DWG は ODA File Converter 経由。
- 2026-10-14: 最小構成のDXF（HEADERに$ACADVERのみ）は Jw_cad で「図形がありません」になった。
  AutoCAD R12 風に修正（コード右寄せ3桁、$EXTMIN/$EXTMAX等、VPORT/STYLE/VIEW/UCS、空BLOCKS、R12にない$MEASUREMENTを削除）。Jw_cadでの確認待ち。
