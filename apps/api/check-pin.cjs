const bcrypt = require("bcryptjs");
const hash = "$2b$12$R7kTO70wwANogQRz6Xmdfey240fSvyH0KRYkH5K4TrufV0Gxo04Mi";
for (const pin of ["5555","9999","0000","admin","1234","1111","2222","3333","4444","6666","7777","8888"]) {
  if (bcrypt.compareSync(pin, hash)) console.log("MATCH:", pin);
}
console.log("DONE");
