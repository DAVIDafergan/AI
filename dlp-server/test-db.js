const mongoose = require('mongoose');
const uri = "mongodb://mongo:CJIYYeWjRwoQChiJPyxBjQGbqbsfgQeu@ballast.proxy.rlwy.net:56402";

console.log("🔄 מנסה להתחבר למסד הנתונים...");

mongoose.connect(uri)
  .then(() => {
    console.log("✅ הצלחנו! המסד מחובר.");
    process.exit(0);
  })
  .catch(err => {
    console.error("❌ תקלה בחיבור:");
    console.error(err);
    process.exit(1);
  });
