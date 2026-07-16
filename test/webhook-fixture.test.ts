import * as fs from "fs";
import * as path from "path";

describe("Webhook fixtures", () => {
  it("loads a minimal pull_request opened payload", () => {
    const raw = fs.readFileSync(
      path.join(__dirname, "fixtures", "pull_request.opened.json"),
      "utf8"
    );
    const payload = JSON.parse(raw) as {
      action: string;
      installation: { id: number };
      pull_request: { number: number; head: { sha: string; ref: string } };
      repository: { full_name: string };
    };
    expect(payload.action).toBe("opened");
    expect(payload.installation.id).toBe(99);
    expect(payload.pull_request.number).toBe(42);
    expect(payload.pull_request.head.ref).toBe("feature/specs");
    expect(payload.repository.full_name).toBe("acme/demo-repo");
  });
});
