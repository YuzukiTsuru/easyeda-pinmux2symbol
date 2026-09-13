# Pinmux2Symbol

嘉立创EDA / EasyEDA 专业版扩展：读取 pinmux CSV，在当前工作区的个人库中生成器件及其关联的可编辑原理图符号。

## 使用

1. 安装依赖并构建扩展：

   ```shell
   npm install
   npm run build
   ```

2. 在 EasyEDA 专业版的扩展管理器中导入 `build/dist/pinmux2symbol_v1.1.8.eext`。
3. 从顶部菜单 `Pinmux2Symbol -> 从 CSV 生成器件和符号` 打开配置与预览窗口。
4. 选择 CSV，调整全局尺寸、字体大小、线宽和颜色。右侧会用真实 pinmux 数据实时预览结果。
5. 点击“生成器件和符号”。扩展会创建个人库符号、写入所有引脚和复用功能，再创建同名器件并关联该符号。

第一行必须包含 `Pin Name` 和 `IO Type`，其它列会被当作复用功能列。仓库中的 [`reference/pinout.csv`](./reference/pinout.csv) 可直接导入。

生成的符号包含：

- 每个 CSV 行一个编号唯一的 PIN；
- `Pin Name` 作为引脚名称，`IO Type` 映射为输入、输出或双向电气类型；
- `FunctionN` 列按原位置显示为独立的 `MUXN` 表格列，空单元格保持对齐；
- 复合 Pin Name 拆分为 `DISABLE` 功能和主 PIN 名称；
- PA、PB、PC 等 Bank 分别生成独立的紧凑表格，并仅保留该 Bank 使用的 MUX 列；列之间使用留白对齐，不绘制竖向分隔线；
- 全部表格文字使用加粗 `Courier New`；配置页显示英寸（默认引脚名称为 `0.08 inch`），引脚属性调用 API 时换算为英寸，普通文本保留符号内部字号单位；
- 所有外框、文字锚点、引脚和表头横线严格对齐 100 mil（2.54 mm）网格；
- 所有 Bank 使用一套全局配置，配置会在扩展中自动保存；
- 可编辑的芯片外框、标题和引脚号/名称属性。
- 同名器件，默认位号为 `U`，加入 BOM，并绑定生成的原理图符号。
- 可在每个 Bank 内预留一行空白电源 IO 空间；默认关闭，可在配置页开启或调整预留行高度。预留区不自动创建文字或引脚，生成后可在 EasyEDA 中自行编辑。

## 开发检查

```shell
npm run lint
npm test
npm run build
```

源码生成器位于 [`src/pinmux.ts`](./src/pinmux.ts)，不依赖 EasyEDA 运行时，可单独测试 CSV 解析和符号源码结构。

> 注意：pinmux 表只包含引脚和复用功能，无法推导 PCB 封装的焊盘尺寸、间距和外形；生成的器件不会自动绑定 PCB footprint，也不会默认转到 PCB。
