/**
 * release.mjs — htmlpdfx.js 发版脚本
 *
 * 用法：
 *   node release.mjs --patch   ← 补丁版本 x.x.N+1
 *   node release.mjs --minor   ← 次版本   x.N+1.0
 *   node release.mjs --major   ← 主版本   N+1.0.0
 *
 * 流程：
 *   1. 跑 test
 *   2. build
 *   3. 升 package.json 版本号
 *   4. 同步 website/.vitepress/config.js nav 版本文字
 *   5. git commit + tag + push
 *   6. npm publish
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { cyan, green, red, yellow } from 'kolorist';

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

function run(cmd) {
  console.log(cyan(`  $ ${cmd}`));
  execSync(cmd, { stdio: 'inherit' });
}

function step(msg) {
  console.log(green(`\n● ${msg}`));
}

function fail(msg) {
  console.error(red(`\n✖ ${msg}`));
  process.exit(1);
}

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const bumpType = ['--patch', '--minor', '--major'].find((f) =>
  args.includes(f),
);

if (!bumpType) {
  console.log(yellow('用法: node release.mjs --patch | --minor | --major'));
  process.exit(1);
}

const releaseType = bumpType.slice(2); // 'patch' | 'minor' | 'major'

// ─── 版本计算 ─────────────────────────────────────────────────────────────────

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);

  if (type === 'major') return `${major + 1}.0.0`;

  if (type === 'minor') return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

// 1. test
step('Running tests...');
run('npm test');

// 2. build
step('Building...');
run('npm run build');

// 3. bump package.json
step(`Bumping version (${releaseType})...`);

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const oldVersion = pkg.version;
const newVersion = bumpVersion(oldVersion, releaseType);

pkg.version = newVersion;
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(cyan(`  ${oldVersion} → ${newVersion}`));

// 4. 同步 config.js nav version text
step('Updating website nav version...');

const configPath = './website/.vitepress/config.js';
const configContent = fs.readFileSync(configPath, 'utf-8');
const updatedConfig = configContent.replace(
  /text:\s*'v\d+\.\d+\.\d+'/,
  `text: 'v${newVersion}'`,
);

if (updatedConfig === configContent) {
  fail("未能在 config.js 中找到版本文字，请检查格式是否为 text: 'vX.X.X'");
}

fs.writeFileSync(configPath, updatedConfig);
console.log(cyan(`  config.js nav → v${newVersion}`));

// 5. git commit + tag + push
step('Committing, tagging and pushing...');
run('git add package.json website/.vitepress/config.js');
run(`git commit -m "chore: release v${newVersion}"`);
run(`git tag v${newVersion}`);
run('git push');
run(`git push origin v${newVersion}`);

// 6. publish
step('Publishing to npm...');
run('npm publish --access public --ignore-scripts');

console.log(green(`\n🎉 Released v${newVersion} successfully!`));
