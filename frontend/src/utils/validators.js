export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

export const validatePhone = (phone) => {
  // Pakistani format verification (03XXXXXXXXX or +923XXXXXXXXX)
  const re = /^((\+92)|(0092)|(0))?3[0-9]{9}$/;
  return re.test(String(phone).replace(/[\s-]/g, ''));
};

export const validatePassword = (password) => {
  return password && password.length >= 8;
};