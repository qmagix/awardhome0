const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

async function run() {
  const file = path.join(__dirname, 'tobeprocessed', 'pdf', 'nycda', 'TBD-houston_Houston-results.pdf');
  const dataBuffer = fs.readFileSync(file);
  
  pdf(dataBuffer).then(function(data) {
    console.log(data.text.substring(0, 2000));
  }).catch(console.error);
}

run();
