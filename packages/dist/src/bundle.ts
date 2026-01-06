/**
 * Bundle script for distribution package.
 *
 * Copies compiled outputs from workspace packages into vendor/ directory
 * with proper node_modules structure for module resolution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distRoot = path.join(__dirname, "..");
const packagesRoot = path.join(distRoot, "..");

interface PackageConfig {
  name: string;
  srcDir: string;
  extraFiles?: string[];
}

const packages: PackageConfig[] = [
  {
    name: "@agent-recorder/core",
    srcDir: "core",
    extraFiles: ["migrations"],
  },
  {
    name: "@agent-recorder/service",
    srcDir: "service",
  },
  {
    name: "@agent-recorder/cli",
    srcDir: "cli",
  },
  {
    name: "@agent-recorder/hooks",
    srcDir: "hooks",
  },
  {
    name: "@agent-recorder/stdio-proxy",
    srcDir: "stdio-proxy",
  },
];

/**
 * Recursively copy a directory.
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Rewrite exports to remove ./dist/ prefix since we copy dist contents to root.
 */
function rewriteExports(
  exports: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!exports) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string") {
      // Remove ./dist/ prefix
      result[key] = value.replace(/^\.\/dist\//, "./");
    } else if (typeof value === "object" && value !== null) {
      // Handle { types: ..., import: ... } style
      const obj = value as Record<string, string>;
      result[key] = Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, v.replace(/^\.\/dist\//, "./")])
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a minimal package.json for the vendored package.
 */
function createVendorPackageJson(
  srcPkgPath: string,
  destPkgPath: string
): void {
  const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, "utf-8")) as {
    name: string;
    version: string;
    type?: string;
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  };

  // Create minimal package.json with only what's needed for module resolution
  // Rewrite exports to point to root (since we copy dist/ contents to package root)
  const vendorPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    type: srcPkg.type ?? "module",
    exports: rewriteExports(srcPkg.exports),
    // Rewrite workspace:* dependencies to point to sibling vendor packages
    dependencies: Object.fromEntries(
      Object.entries(srcPkg.dependencies ?? {})
        .filter(([, version]) => !String(version).startsWith("workspace:"))
        .map(([name, version]) => [name, version])
    ),
  };

  fs.writeFileSync(destPkgPath, JSON.stringify(vendorPkg, null, 2) + "\n");
}

/**
 * Main bundle function.
 */
function bundle(): void {
  const vendorRoot = path.join(distRoot, "vendor", "node_modules");

  // Clean vendor directory
  if (fs.existsSync(vendorRoot)) {
    fs.rmSync(vendorRoot, { recursive: true });
  }
  fs.mkdirSync(vendorRoot, { recursive: true });

  console.log("Bundling packages into vendor/...");

  for (const pkg of packages) {
    const srcPkgDir = path.join(packagesRoot, pkg.srcDir);
    const srcDistDir = path.join(srcPkgDir, "dist");
    const srcPkgJson = path.join(srcPkgDir, "package.json");

    // Destination in vendor/node_modules/@agent-recorder/{name}
    const destPkgDir = path.join(vendorRoot, pkg.name);

    if (!fs.existsSync(srcDistDir)) {
      console.error(`Error: ${srcDistDir} does not exist. Run pnpm build first.`);
      process.exit(1);
    }

    console.log(`  Copying ${pkg.name}...`);

    // Copy dist/ contents to package root (so exports work correctly)
    copyDir(srcDistDir, destPkgDir);

    // Copy extra files if specified (e.g., migrations)
    for (const extra of pkg.extraFiles ?? []) {
      const srcExtra = path.join(srcPkgDir, extra);
      if (fs.existsSync(srcExtra)) {
        const destExtra = path.join(destPkgDir, extra);
        if (fs.statSync(srcExtra).isDirectory()) {
          copyDir(srcExtra, destExtra);
        } else {
          fs.copyFileSync(srcExtra, destExtra);
        }
      }
    }

    // Create vendor package.json
    createVendorPackageJson(srcPkgJson, path.join(destPkgDir, "package.json"));
  }

  console.log("Bundle complete!");
}

bundle();
