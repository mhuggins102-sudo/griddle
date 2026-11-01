// Bottom sheets (help, tutorial, settings, stats): show and hide one, and keep the page behind it
// from scrolling while any sheet is open.

function update() {
  const open = Array.from(document.querySelectorAll('.sheet')).some((s) => !s.hidden);
  document.body.classList.toggle('sheet-open', open);
}

export function openSheet(el) {
  el.hidden = false;
  const scroll = el.querySelector('.sheet-scroll');
  if (scroll) scroll.scrollTop = 0;
  update();
}

export function closeSheet(el) {
  el.hidden = true;
  update();
}
