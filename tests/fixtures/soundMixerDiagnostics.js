addEventListener('error',event=>document.getElementById('fixture-errors').textContent+=event.message+'\n');
addEventListener('unhandledrejection',event=>document.getElementById('fixture-errors').textContent+=(event.reason?.stack||event.reason)+'\n');
