import * as fs from "fs";
import * as path from "path";

describe("generateProjectStructure", () => {
  it("uses a current default Gemini model (not retired gemini-1.5-flash)", () => {
    const filePath = path.join(__dirname, "generateProjectStructure.ts");
    const src = fs.readFileSync(filePath, "utf8");
    expect(src).not.toMatch(/gemini-1\.5-flash/);
    expect(src).toMatch(/gemini-2\.5-flash/);
  });
});
