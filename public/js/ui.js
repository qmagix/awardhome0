document.addEventListener('DOMContentLoaded', () => {
  // --- Tabs Logic ---
  const tabs = document.querySelectorAll('.tab-item');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      // Activate clicked
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.getAttribute('data-target'));
      if (targetPane) {
        targetPane.classList.add('active');
        
        // Auto-expand the first accordion of this newly visible tab if not already expanded
        const firstAccordionHeader = targetPane.querySelector('.accordion-header');
        if (firstAccordionHeader && !firstAccordionHeader.classList.contains('active')) {
          firstAccordionHeader.click();
        }
      }
    });
  });

  // --- Accordion Logic ---
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  accordionHeaders.forEach(header => {
    header.addEventListener('click', function() {
      this.classList.toggle('active');
    });
  });
});
