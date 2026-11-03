import * as assert from "assert";
import * as path from "path";
import { isImage } from "../utils/utils";
import { ImageVariantUtils } from "../utils/image-variant-utils";
import { extractL10nKeyFromCall, strCallRegex } from "../utils/regexp-utils";
import { FileTemplateUtils } from "../command/file-template/file-template-utils";

suite("Pure helper utils", () => {
  test("isImage 只接受真实的图片扩展名", () => {
    assert.strictEqual(isImage("a.png"), true);
    assert.strictEqual(isImage("a.PNG"), true);
    assert.strictEqual(isImage("a.webp"), true);
    assert.strictEqual(isImage("apng"), false);
    assert.strictEqual(isImage("a.png.txt"), false);
  });

  test("ImageVariantUtils.getBaseDir 去掉变体目录", () => {
    const base = path.join("/tmp", "assets", "images");
    assert.strictEqual(
      ImageVariantUtils.getBaseDir(path.join(base, "2.0x", "a.png")),
      base,
    );
    assert.strictEqual(
      ImageVariantUtils.getBaseDir(path.join(base, "a.png")),
      base,
    );
  });

  test("extractL10nKeyFromCall 兼容 S.current 与带参数的 S.of", () => {
    assert.strictEqual(extractL10nKeyFromCall("S.current.hello"), "hello");
    assert.strictEqual(
      extractL10nKeyFromCall("S.of(context).hello(name)"),
      "hello",
    );
    assert.strictEqual(
      extractL10nKeyFromCall("S.of(context).hello(name).toUpperCase()"),
      "hello",
    );
    assert.strictEqual(extractL10nKeyFromCall("Images.foo"), null);
  });

  test("strCallRegex 不会吞掉后续链式调用", () => {
    const text = "S.of(context).hello(name).toUpperCase()";
    const matches = Array.from(text.matchAll(strCallRegex));
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0][0], "S.of(context).hello(name)");
  });

  test("getPlaceHolders 解析模板占位符", () => {
    const placeholders = FileTemplateUtils.getPlaceHolders(
      "#pageName# #DATE# #desc#",
    );
    assert.deepStrictEqual(Array.from(placeholders), [
      "#pageName#",
      "#DATE#",
      "#desc#",
    ]);
  });
});
