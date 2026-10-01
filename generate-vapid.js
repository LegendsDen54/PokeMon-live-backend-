const webpush = require("web-push");

const keys = webpush.generateVAPIDKeys();

console.log("NEW VAPID KEY PAIR GENERATED");
console.log("PUBLIC=" + keys.publicKey);
console.log("PRIVATE=" + keys.privateKey);
console.log("IMPORTANT: Copy these directly into Render Environment. Do not share them.");