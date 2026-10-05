<script lang="ts">
  const PATHS: Record<string, string> = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    stop: 'M6 6h12v12H6z',
    prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
    loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
    minus: 'M5 11h14v2H5z',
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    share: 'M18 16a3 3 0 0 0-2.4 1.2L8.9 13.7a3 3 0 0 0 0-1.4l6.7-3.5A3 3 0 1 0 15 7c0 .2 0 .5.1.7L8.4 11.2a3 3 0 1 0 0 3.6l6.7 3.5-.1.7a3 3 0 1 0 3-3z',
    settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.9a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7 7 0 0 0 1.7 1L11 21h4l.4-2.9a7 7 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    up: 'M7 14l5-5 5 5z',
    down: 'M7 10l5 5 5-5z',
    trash: 'M6 7h12l-1 13H7zm3-3h6l1 2H8z',
    copy: 'M8 8h11v12H8zM5 4h11v2H7v9H5z',
    tap: 'M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V7a2 2 0 1 0-4 0v2.5A4 4 0 0 1 12 2zm-1 6h2v6l4.5 1.2c.9.2 1.5 1 1.5 2V22H9l-4-5 1.3-1.3L11 18z',
    folder: 'M3 6h7l2 2h9v11H3z',
    save: 'M5 3h11l3 3v15H5zm3 0v5h8V3zM8 13h8v6H8z',
    repeat: 'M4 5h2v14H4zm4 0h1v14H8zm3 5h2v2h-2zm0 3h2v2h-2zm7-8h2v14h-2z',
    pauseItem: 'M4 16a8 8 0 0 1 16 0h-2a6 6 0 0 0-12 0zm8-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    bars: 'M3 5h2v14H3zm8 0h2v14h-2zm8 0h2v14h-2zM6 15h4v2H6zm8-4h4v2h-4z',
    expand: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
    shrink: 'M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z',
    more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
    close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
    help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 16h-2v-2h2zm2-7.5c-.6.9-1.9 1.4-2 2.5h-2c0-2 1.5-2.6 2.2-3.4.6-.7.4-2-.9-2.1-1-.1-1.6.7-1.7 1.5H8.6c.1-2 1.6-3.5 3.6-3.5 3 0 4 2.9 2.8 5z',
  };
  let { name, size = 20 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d={PATHS[name]} /></svg>
