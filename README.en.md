[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Pinmux2Symbol

A JLCEDA / EasyEDA Pro extension: it reads a pinmux CSV and generates a device and its associated editable schematic symbol in the personal library of the current workspace.

## Usage

1. Install the dependencies and build the extension:

   ```shell
   npm install
   npm run build
   ```

2. Import `build/dist/pinmux2symbol_v1.1.8.eext` in the EasyEDA Pro extension manager.
3. Open the configuration and preview window from the top menu `Pinmux2Symbol -> 从 CSV 生成器件和符号` (Generate device and symbol from CSV).
4. Pick a CSV and adjust the global dimensions, font sizes, line widths and colors. The right-hand pane previews the result in real time using the actual pinmux data.
5. Click “生成器件和符号”. The extension creates the personal-library symbol, writes every pin and multiplexing function, then creates a device with the same name and binds it to that symbol.

The first row must contain `Pin Name` and `IO Type`; every other column is treated as a multiplexing function column. [`reference/pinout.csv`](./reference/pinout.csv) in this repository can be imported directly.

The generated symbol contains:

- one uniquely numbered PIN per CSV row;
- `Pin Name` as the pin name, with `IO Type` mapped to an input, output or bidirectional electrical type;
- `FunctionN` columns shown as separate `MUXN` table columns in their original positions, with empty cells keeping their alignment;
- composite Pin Names split into a `DISABLE` function and the main PIN name;
- Banks such as PA, PB and PC each generated as an independent compact table that keeps only the MUX columns that Bank uses; columns are aligned with blank space and no vertical separators are drawn;
- all table text in bold `Courier New`; the configuration page shows inches (the default pin name size is `0.08 inch`), pin attributes are converted to inches when calling the API, and plain text keeps the symbol's internal font-size unit;
- every outline, text anchor, pin and header rule strictly aligned to the 100 mil (2.54 mm) grid;
- one global configuration shared by all Banks, saved automatically inside the extension;
- an editable chip outline, title, and pin number/name attributes;
- a device with the same name, default reference designator `U`, added to the BOM and bound to the generated schematic symbol;
- an optional blank power IO row reserved inside every Bank; off by default, it can be enabled and resized on the configuration page. The reserved area never creates text or pins automatically, and can be edited by hand in EasyEDA after generating.

## Development checks

```shell
npm run lint
npm test
npm run build
```

The source generator lives in [`src/pinmux.ts`](./src/pinmux.ts) and does not depend on the EasyEDA runtime, so CSV parsing and the symbol source structure can be tested on their own.

> Note: a pinmux table only contains pins and multiplexing functions, so the pad size, pitch and outline of a PCB footprint cannot be derived from it; the generated device does not bind a PCB footprint automatically and is not sent to the PCB by default.
