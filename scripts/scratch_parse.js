const fs = require('fs');
const PDFParser = require("pdf2json");

const pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
  let fullText = "";
  pdfData.Pages.forEach(page => {
    // Sort text elements by Y, then by X to roughly read top-to-bottom, left-to-right
    const texts = page.Texts.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 0.5) return a.y - b.y;
        return a.x - b.x;
    });
    
    texts.forEach(text => {
      const decodedText = decodeURIComponent(text.R[0].T);
      fullText += decodedText + " | ";
    });
    fullText += "\n\n--- PAGE BREAK ---\n\n";
  });
  
  fs.writeFileSync('showstopper_sample.txt', fullText);
  console.log('Sample written to showstopper_sample.txt');
});

pdfParser.loadPDF("/Users/q/AI/test/awardhomebootstrap/tobeprocessed/pdf/showstopper/2025/anaheim-ii.pdf");
