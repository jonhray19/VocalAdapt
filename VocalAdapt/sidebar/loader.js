// sidebar/loader.js
document.addEventListener("DOMContentLoaded", () => {
    fetch('../sidebar/sidebar.html')
        .then(response => {
            if (!response.ok) throw new Error("Sidebar fetch failed");
            return response.text();
        })
        .then(data => {
            const sidebarContainer = document.getElementById('sidebar-container');
            if (sidebarContainer) {
                sidebarContainer.innerHTML = data;
                
                // ==========================================
                // NEW: DYNAMIC ACTIVE LINK HIGHLIGHTER
                // ==========================================
                let currentPath = window.location.pathname;
                if (currentPath.endsWith('/')) currentPath += 'index.html'; // Handle root folder

                // Find all navigation links in the sidebar
                const navLinks = sidebarContainer.querySelectorAll('nav a');
                
                navLinks.forEach(link => {
                    // Skip the external Student Portal link
                    if (link.getAttribute('target') === '_blank') return;

                    // Get the absolute path of the link
                    let targetPath = new URL(link.href).pathname;
                    if (targetPath.endsWith('/')) targetPath += 'index.html';

                    if (targetPath === currentPath) {
                        // --- 1. SET CURRENT PAGE TO ACTIVE ---
                        link.classList.remove('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
                        link.classList.add('bg-white/5', 'text-blue-400', 'ring-1', 'ring-white/10', 'shadow-sm');
                        
                        // Add the blue indicator line
                        if (!link.querySelector('.absolute.left-0')) {
                            const indicator = document.createElement('div');
                            indicator.className = 'absolute left-0 top-0 h-full w-1 bg-blue-500 rounded-r';
                            link.prepend(indicator);
                        }
                        
                        // Make SVG icon glowing blue
                        const svg = link.querySelector('svg');
                        if (svg) {
                            svg.classList.remove('text-zinc-500', 'group-hover:text-blue-400');
                            svg.classList.add('text-blue-400', 'drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]');
                        }
                    } else {
                        // --- 2. REVERT OTHERS TO INACTIVE (Fixes hardcoded Enroll Student) ---
                        if (link.classList.contains('bg-white/5')) {
                            link.classList.remove('bg-white/5', 'text-blue-400', 'ring-1', 'ring-white/10', 'shadow-sm');
                            link.classList.add('text-zinc-400', 'hover:text-zinc-100', 'hover:bg-zinc-800/50');
                            
                            // Remove the blue indicator line
                            const indicator = link.querySelector('.absolute.left-0');
                            if (indicator) indicator.remove();
                            
                            // Revert SVG icon to gray
                            const svg = link.querySelector('svg');
                            if (svg) {
                                svg.classList.remove('text-blue-400', 'drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]');
                                svg.classList.add('text-zinc-500', 'group-hover:text-blue-400');
                            }
                        }
                    }
                });
            }
        })
        .catch(error => console.error('Error loading sidebar:', error));
});