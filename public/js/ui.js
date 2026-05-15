document.addEventListener('DOMContentLoaded', () => {
  // --- Tabs Logic ---
  const tabs = document.querySelectorAll('.tab-item');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Find closest container that wraps both tabs and panes, default to document if none found
      const container = tab.closest('#leaderboard-studios-wrapper') || tab.closest('#leaderboard-dancers-wrapper') || document;
      
      // Deactivate all within container
      container.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      // Activate clicked
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.getAttribute('data-target'));
      if (targetPane) {
        targetPane.classList.add('active');
        
        // Auto-expand the first accordion ONLY if there is exactly 1 event
        const accordions = targetPane.querySelectorAll('.accordion');
        if (accordions.length === 1) {
          const firstAccordionHeader = accordions[0].querySelector('.accordion-header');
          if (firstAccordionHeader && !firstAccordionHeader.classList.contains('active')) {
            firstAccordionHeader.click();
          }
        }
      }
    });
  });

  // --- Accordion Logic (Event Delegation for Dynamic Content) ---
  document.addEventListener('click', function(e) {
    const header = e.target.closest('.accordion-header');
    if (header) {
      header.classList.toggle('active');
    }
  });
});
