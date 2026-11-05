"""Run every standalone Node regression suite; fail on the first failed suite."""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
tests = sorted((root / "tests").glob("*-regressions.js"))
tests.insert(0, root / "tests" / "run-tests.js")
for test in tests:
    print(f"\n== {test.name} ==", flush=True)
    subprocess.run(["node", str(test)], cwd=root, check=True)
print(f"\nAll {len(tests)} suites passed.")
