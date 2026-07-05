const fs = require("fs");
const path = require("path");

const env = require("../../config/env");

const rootDirectory = path.resolve(env.uploads.directory);
fs.mkdirSync(rootDirectory, { recursive: true });

function resolveStoragePath(storageKey) {
  const resolvedPath = path.resolve(rootDirectory, storageKey);

  if (!resolvedPath.startsWith(`${rootDirectory}${path.sep}`)) {
    throw new Error("Invalid storage key.");
  }

  return resolvedPath;
}

async function writeObject({ storageKey, sourcePath }) {
  const destinationPath = resolveStoragePath(storageKey);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.rename(sourcePath, destinationPath);
  return { provider: "local", storageKey };
}

function getObjectPath(storageKey) {
  return resolveStoragePath(storageKey);
}

async function deleteObject(storageKey) {
  try {
    await fs.promises.unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

module.exports = {
  deleteObject,
  getObjectPath,
  writeObject,
};
