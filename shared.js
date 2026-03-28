function isMobileDevice() {
    const narrow = window.innerWidth <= 768;
    const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return narrow || ua;
}

function setBrush(b) {
    activeBrush = b;
    document.querySelectorAll('.brush').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.brush[data-brush="${b}"]`).forEach(el => el.classList.add('active'));
}
