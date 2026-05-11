const fs = require('fs');

const file = 'views/dancer.ejs';
let content = fs.readFileSync(file, 'utf8');

const soloStart = content.indexOf('<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2rem;">');
const groupStart = content.indexOf('<h2 style="margin-top: 3rem;">Group Awards</h2>');
const scriptStart = content.indexOf('<script>');

if (soloStart > -1 && groupStart > -1 && scriptStart > -1) {
    const soloHeaderToggle = content.substring(soloStart, content.indexOf('<div class="awards-view-grid awards-grid">', soloStart));
    
    // We want the group section to have the view toggle.
    let newSoloHeader = '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3rem;">\n    <h2>Solo Awards</h2>\n  </div>\n';
    
    // But we actually need to grab the blocks.
    const soloBlock = content.substring(content.indexOf('<div class="awards-view-grid awards-grid">', soloStart), groupStart);
    const groupBlock = content.substring(content.indexOf('<div class="awards-view-grid awards-grid">', groupStart), scriptStart);
    
    // Group header with toggle:
    let newGroupHeader = soloHeaderToggle.replace('<h2>Solo Awards</h2>', '<h2>Group Awards</h2>');
    
    // The script expects class="awards-view-grid" so everything works.
    
    const headPart = content.substring(0, soloStart);
    const tailPart = content.substring(scriptStart);
    
    const newContent = headPart + newGroupHeader + groupBlock + newSoloHeader + soloBlock + tailPart;
    
    fs.writeFileSync(file, newContent);
    console.log("Successfully swapped Group and Solo awards sections.");
} else {
    console.log("Could not find blocks.");
}
