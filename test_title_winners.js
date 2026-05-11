const fs = require('fs');

const lines = fs.readFileSync('abq_ysorted.txt', 'utf8').split('\n');

let currentCategory = "";
for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    if (line.includes(" ~ ")) {
        currentCategory = line;
        continue;
    }

    const placementMatch = line.match(/^(1st Runner Up|2nd Runner Up|3rd Runner Up|4th Runner Up|5th Runner Up|WINNER|1st|2nd|3rd|\d+th|DIAMOND|RUBY|EMERALD|SAPPHIRE|CRYSTAL)\s+(.+)$/i);
    if (placementMatch) {
        if (currentCategory.toLowerCase().includes("title winner")) {
            const place = placementMatch[1];
            let rest = placementMatch[2];
            
            const tokens = rest.split(/\s{2,}/).map(t => t.trim()).filter(t => t.length > 0);
            
            console.log(`[${currentCategory}] PLACE: ${place}`);
            console.log(`TOKENS (${tokens.length}):`, tokens);
            
            let studio = null;
            let dancer = null;
            let routine = null;
            if (tokens.length >= 2) {
                studio = tokens[0];
                dancer = tokens.slice(1).join(' ');
                routine = "Title Winner";
            } else {
                console.log("FAILED TO PARSE TOKENS FOR TITLE WINNER!");
            }
            console.log(`-> STUDIO: ${studio} | DANCER: ${dancer}\n`);
        }
    }
}
