import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import MIcon from "./MIcon";

describe("MIcon", () => {
  test("預設使用 outlined 字型，filled 可切換實心字型", () => {
    expect(renderToStaticMarkup(<MIcon name="push_pin" />)).toContain(
      'class="material-icons-outlined"',
    );
    expect(renderToStaticMarkup(<MIcon name="push_pin" filled />)).toContain(
      'class="material-icons"',
    );
  });
});
