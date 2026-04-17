const mongoose = require('mongoose');
const uri = process.env.MONGODB_URI;

console.log("🔄 מנסה להתחבר למסד הנתונים...");

if (!uri) {
  console.error("❌ חסר MONGODB_URI בסביבה");
  process.exit(1);
}

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
