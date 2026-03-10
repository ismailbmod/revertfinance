const priceA = 0.0004932977042430086;
const cleanClose = 2023.05;
const priceB = 1 / priceA;
const devA = Math.abs(priceA - cleanClose) / cleanClose;
const devB = Math.abs(priceB - cleanClose) / cleanClose;
const minDev = Math.min(devA, devB);
console.log({ priceA, priceB, cleanClose, devA, devB, minDev });
