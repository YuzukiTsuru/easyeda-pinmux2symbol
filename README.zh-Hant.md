[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](#) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Pinmux2Symbol

嘉立創EDA / EasyEDA 專業版擴展程式：讀取 pinmux CSV，在目前工作空間的個人庫中產生器件及其關聯的可編輯原理圖符號。

## 使用方式

1. 安裝相依套件並建置擴展程式：

   ```shell
   npm install
   npm run build
   ```

2. 在 嘉立創EDA 專業版的擴展程式管理員中匯入 `build/dist/pinmux2symbol_v1.1.8.eext`。
3. 從頂部選單 `Pinmux2Symbol -> 从 CSV 生成器件和符号` 開啟設定與預覽視窗。
4. 選擇 CSV，調整全域尺寸、字型大小、線寬與顏色。右側會以真實 pinmux 資料即時預覽結果。
5. 點選「生成器件和符号」。擴展程式會建立個人庫符號、寫入所有引腳與複用功能，再建立同名器件並關聯該符號。

第一列必須包含 `Pin Name` 與 `IO Type`，其他欄位會被視為複用功能欄。倉庫中的 [`reference/pinout.csv`](./reference/pinout.csv) 可直接匯入。

產生的符號包含：

- 每個 CSV 列一個編號唯一的 PIN；
- `Pin Name` 作為引腳名稱，`IO Type` 對應為輸入、輸出或雙向電氣類型；
- `FunctionN` 欄依原位置顯示為獨立的 `MUXN` 表格欄，空儲存格保持對齊；
- 複合 Pin Name 拆分為 `DISABLE` 功能與主 PIN 名稱；
- PA、PB、PC 等 Bank 分別產生獨立的緊湊表格，並僅保留該 Bank 使用的 MUX 欄；欄與欄之間以留白對齊，不繪製縱向分隔線；
- 全部表格文字使用粗體 `Courier New`；設定頁顯示英寸（預設引腳名稱為 `0.08 inch`），引腳屬性呼叫 API 時換算為英寸，一般文字保留符號內部字型大小單位；
- 所有外框、文字錨點、引腳與表頭橫線嚴格對齊 100 mil（2.54 mm）網格；
- 所有 Bank 使用一組全域設定，設定會自動儲存在擴展程式中；
- 可編輯的晶片外框、標題與引腳編號／名稱屬性；
- 同名器件，預設位號為 `U`，加入 BOM，並綁定產生的原理圖符號；
- 可在每個 Bank 內預留一列空白電源 IO 空間；預設關閉，可在設定頁開啟或調整預留列高度。預留區不會自動建立文字或引腳，產生後可在 EasyEDA 中自行編輯。

## 開發檢查

```shell
npm run lint
npm test
npm run build
```

原始碼產生器位於 [`src/pinmux.ts`](./src/pinmux.ts)，不依賴 EasyEDA 執行環境，可單獨測試 CSV 解析與符號原始碼結構。

> 注意：pinmux 表只包含引腳與複用功能，無法推導 PCB 封裝的焊墊尺寸、間距與外形；產生的器件不會自動綁定 PCB footprint，也不會預設轉到 PCB。
