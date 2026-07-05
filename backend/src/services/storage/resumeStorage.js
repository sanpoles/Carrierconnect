const localResumeStorage = require("./localResumeStorage");

async function writeResumeObject(input) {
  return localResumeStorage.writeObject(input);
}

function getResumeObjectPath(storageKey) {
  return localResumeStorage.getObjectPath(storageKey);
}

async function deleteResumeObject(storageKey) {
  return localResumeStorage.deleteObject(storageKey);
}

module.exports = {
  deleteResumeObject,
  getResumeObjectPath,
  writeResumeObject,
};
