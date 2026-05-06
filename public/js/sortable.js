document.addEventListener('DOMContentLoaded', () => {
  const getCellValue = (tr, idx) => tr.children[idx].innerText || tr.children[idx].textContent;

  const parseValue = (str) => {
    // Try to extract leading numbers for proper sorting of "1st", "2nd", "10th", "#123" etc.
    str = str.trim();
    if (str.startsWith('#')) {
      str = str.substring(1);
    }
    const match = str.match(/^(-?\d+)/);
    return match ? parseInt(match[1], 10) : str.toLowerCase();
  };

  const comparer = (idx, asc) => (a, b) => {
    let v1 = getCellValue(asc ? a : b, idx);
    let v2 = getCellValue(asc ? b : a, idx);
    
    let p1 = parseValue(v1);
    let p2 = parseValue(v2);
    
    if (typeof p1 === 'number' && typeof p2 === 'number') {
      return p1 - p2;
    }
    return p1.toString().localeCompare(p2.toString());
  };

  document.querySelectorAll('th').forEach(th => th.addEventListener('click', (() => {
    const table = th.closest('table');
    if (!table || !table.classList.contains('sortable-table')) return;
    
    const isAsc = th.classList.contains('asc');
    
    Array.from(th.parentNode.children).forEach(sibling => {
      sibling.classList.remove('asc', 'desc');
    });

    th.classList.toggle('asc', !isAsc);
    th.classList.toggle('desc', isAsc);

    Array.from(table.querySelectorAll('tbody tr'))
      .sort(comparer(Array.from(th.parentNode.children).indexOf(th), !isAsc))
      .forEach(tr => table.querySelector('tbody').appendChild(tr));
  })));
});
