function normalizePhone(countryCode, phoneNumber) {
  const normalizedCountryCode = String(countryCode || "")
    .trim()
    .replace(/[^\d+]/g, "");
  const normalizedNumber = String(phoneNumber || "").replace(/\D/g, "");

  if (!/^\+[1-9]\d{0,3}$/.test(normalizedCountryCode)) {
    return {
      valid: false,
      message: "Choose a valid country code, for example +91 or +1.",
    };
  }

  if (!/^\d{4,14}$/.test(normalizedNumber)) {
    return {
      valid: false,
      message: "Enter a valid phone number with 4 to 14 digits.",
    };
  }

  const phoneE164 = `${normalizedCountryCode}${normalizedNumber}`;

  if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    return {
      valid: false,
      message:
        "Enter a valid phone number including country code and local number.",
    };
  }

  return {
    valid: true,
    countryCode: normalizedCountryCode,
    phoneNumber: normalizedNumber,
    phoneE164,
  };
}

function hasValidServicePhone(user) {
  if (user?.phone_country_code && user?.phone_number && user?.phone_e164) {
    return normalizePhone(user.phone_country_code, user.phone_number).valid;
  }

  return false;
}

module.exports = {
  normalizePhone,
  hasValidServicePhone,
};
