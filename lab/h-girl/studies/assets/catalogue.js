const state = document.querySelector('#button-state');
state.addEventListener('change', () => {
  for (const label of document.querySelectorAll('[data-start]')) {
    label.textContent = state.value === 'continue' ? 'Продолжить прогулку' : label.dataset.start;
  }
});
document.querySelector('#study-background').addEventListener('change', event => {
  document.body.dataset.background = event.target.value;
});
const progress = document.querySelector('#loading-progress');
progress.addEventListener('input', () => {
  document.querySelector('#loading').style.setProperty('--progress', String(progress.valueAsNumber / 100));
  document.querySelector('#loading-percent').value = progress.value + '%';
});
