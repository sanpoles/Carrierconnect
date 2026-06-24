function createRequestNumber(requestType) {
  const prefix =
    requestType === "mock_interview" ? "MI" : "CC";

  const timestamp = Date.now().toString().slice(-8);
  const randomValue = Math.floor(Math.random() * 900 + 100);

  return `${prefix}-${timestamp}-${randomValue}`;
}

module.exports = {
  createRequestNumber,
};