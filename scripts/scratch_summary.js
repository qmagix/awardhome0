const testAge = "PRE-COMPETITIVE AGE DIVISION";
let ageDiv = testAge.replace(/ AGE DIVISION/i, '').trim();
ageDiv = ageDiv.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
console.log(ageDiv);
