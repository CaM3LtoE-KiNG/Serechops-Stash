(async function () {
    'use strict';

    if (window.newReleaseTrackerPluginLoaded) {
        console.log("New Release Tracker Plugin is already loaded");
        return;
    }
    window.newReleaseTrackerPluginLoaded = true;

    console.log("New Release Tracker Plugin started");
    console.log("Current page path:", window.location.pathname);

    /**
     * CONFIGURATION
     */
    const storedDateRange = localStorage.getItem('newReleaseDateRange');
    const config = {
        baseURL: window.location.origin,
        localEndpoint: `${window.location.origin}/graphql`,
        stashBoxes: [], // Array to hold all external stashBoxes excluding ThePornDB
        apiKey: localStorage.getItem('apiKey') || null,
        defaultDateRange: storedDateRange ? parseInt(storedDateRange, 10) : 7,
    };

    /**
     * Utility Function to Wait for Elements
     */
    function waitForElement(selector, callback) {
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches(selector)) {
                            callback(node);
                        }
                        // Recursively check child nodes
                        node.querySelectorAll && node.querySelectorAll(selector).forEach(callback);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Function to stop observing if needed in the future
        function stopObserving() {
            observer.disconnect();
        }

        return stopObserving;
    }

    /**
     * Debounce Function to Limit Frequency of Function Execution
     */
    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(null, args);
            }, delay);
        };
    };

    /**
     * GraphQL Query Functions
     */
    const gqlHeaders = (endpoint, apiKey) => {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Apikey'] = apiKey; // Use Apikey header for authenticated requests
        }
        return headers;
    };

    const performGraphQLQuery = async (endpoint, query, variables = {}, apiKey = null) => {
        console.log(`Performing GraphQL Query to: ${endpoint}`);
        console.log(`Query: ${query.trim()}`);
        console.log(`Variables: ${JSON.stringify(variables, null, 2)}`);

        if (apiKey) {
            console.log(`Using API key for ${endpoint}: ${apiKey}`);
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: gqlHeaders(endpoint, apiKey),
                body: JSON.stringify({ query, variables }),
            });
            const data = await response.json();
            console.log("Full response from GraphQL:", JSON.stringify(data, null, 2));
            if (data.errors) {
                console.error(`GraphQL Errors at ${endpoint}:`, data.errors);
                return null;
            }
            return data?.data || null;
        } catch (error) {
            console.error(`GraphQL Query Error at ${endpoint}:`, error);
            return null;
        }
    };

    /**
     * Retrieve All External StashBoxes from Configuration
     * Excluding ThePornDB
     */
    const getAllStashBoxes = async () => {
        const query = `
            query Configuration {
                configuration {
                    general {
                        stashBoxes {
                            endpoint
                            api_key
                            name
                        }
                    }
                }
            }
        `;
        const result = await performGraphQLQuery(config.localEndpoint, query, {}, config.apiKey);
        if (!result?.configuration?.general?.stashBoxes) {
            console.warn("No stashBoxes found in the configuration.");
            return;
        }

        // Filter out ThePornDB
        const filteredStashBoxes = result.configuration.general.stashBoxes.filter(box => {
            return box.endpoint !== 'https://theporndb.net/graphql';
        });

        config.stashBoxes = filteredStashBoxes;
        console.log("External StashBoxes retrieved (excluding ThePornDB):", config.stashBoxes);
    };

    /**
     * Retrieve StashDB API Key from Local Configuration
     * Preserved for backward compatibility
     */
    const getStashDBApiKey = async () => {
        const stashDBBox = config.stashBoxes.find(
            (box) => box.endpoint === 'https://stashdb.org/graphql'
        );
        if (stashDBBox) {
            config.stashDBApiKey = stashDBBox.api_key;
            console.log("StashDB API key retrieved successfully:", config.stashDBApiKey);
        } else {
            console.warn("StashDB API key not found in external StashBoxes configuration");
        }
    };

    /**
     * Retrieve Stash IDs for Multiple Performers from Local Endpoint
     */
    const getPerformerStashIDs = async (performerIds) => {
        if (performerIds.length === 0) return {};

        // Construct a GraphQL query with aliases for each performer
        const aliases = performerIds.map((id, index) => `performer${index}`);
        const query = `
            query FindPerformers {
                ${aliases.map((alias, index) => `
                    ${alias}: findPerformer(id: "${performerIds[index]}") {
                        stash_ids {
                            endpoint
                            stash_id
                        }
                    }
                `).join('\n')}
            }
        `;

        const result = await performGraphQLQuery(config.localEndpoint, query, {}, config.apiKey);
        if (!result) {
            console.warn("Failed to retrieve stash_ids for performers.");
            return {};
        }

        const performerStashMap = {};

        aliases.forEach((alias, index) => {
            const stashIds = result?.[alias]?.stash_ids || [];
            stashIds.forEach(idObj => {
                // Exclude ThePornDB explicitly
                if (idObj.endpoint === 'https://theporndb.net/graphql') return;

                if (!performerStashMap[performerIds[index]]) {
                    performerStashMap[performerIds[index]] = {};
                }
                performerStashMap[performerIds[index]][idObj.endpoint] = idObj.stash_id;
            });
        });

        console.log("Performer to StashID map:", JSON.stringify(performerStashMap, null, 2));
        return performerStashMap; // { performerId: { endpoint1: stash_id1, endpoint2: stash_id2, ... }, ... }
    };

    /**
     * Retrieve New Releases (Scenes) for Multiple StashIDs from External Endpoints
     */
    const getNewReleasesForStashIDs = async (performerStashMap) => {
        const stashScenesMap = {}; // { endpoint: { stash_id: scenes[] } }

        // Iterate through each external stashBox
        for (const stashBox of config.stashBoxes) {
            const { endpoint, api_key, name } = stashBox;
            if (!api_key) {
                console.warn(`Skipping stashBox ${name} (${endpoint}) due to missing API key.`);
                continue;
            }

            // Collect all stash_ids for this endpoint
            const stashIds = [];
            Object.values(performerStashMap).forEach(stashObj => {
                if (stashObj[endpoint]) {
                    stashIds.push(stashObj[endpoint]);
                }
            });

            if (stashIds.length === 0) continue;

            // Construct a GraphQL query with aliases for each stashId
            const aliases = stashIds.map((id, index) => `stash${index}`);
            const query = `
                query FindPerformers {
                    ${aliases.map((alias, index) => `
                        ${alias}: findPerformer(id: "${stashIds[index]}") {
                            scenes {
                                id
                                title
                                release_date
                                images {
                                    url
                                    width
                                    height
                                }
                            }
                        }
                    `).join('\n')}
                }
            `;

            const result = await performGraphQLQuery(endpoint, query, {}, api_key);
            if (!result) {
                console.warn(`Failed to retrieve scenes from ${name} (${endpoint}).`);
                continue;
            }

            aliases.forEach((alias, index) => {
                const stashId = stashIds[index];
                const scenes = result?.[alias]?.scenes || [];

                if (!stashScenesMap[endpoint]) {
                    stashScenesMap[endpoint] = {};
                }
                stashScenesMap[endpoint][stashId] = scenes;
            });

            console.log(`New Releases from ${name} (${endpoint}):`, JSON.stringify(stashScenesMap[endpoint], null, 2));
        }

        return stashScenesMap; // { endpoint: { stash_id: scenes[] }, ... }
    };

    /**
     * Create a Popout for Scene Previews Aggregated from Multiple StashBoxes
     */
	const createScenePreviewPopout = (stashScenesMap, referenceElement) => {
		// Remove any existing popout
		const existingPopout = document.getElementById('scene-preview-popout');
		if (existingPopout) {
			existingPopout.remove();
		}
	
		// Create the popout container
		const popout = document.createElement('div');
		popout.id = 'scene-preview-popout';
		popout.style.position = 'absolute';
		popout.style.backgroundColor = '#2c2c2c';
		popout.style.color = '#fff';
		popout.style.padding = '10px';
		popout.style.borderRadius = '8px';
		popout.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
		popout.style.zIndex = '10000'; // Ensure it's on top
		popout.style.width = '300px';
		popout.style.maxHeight = '400px';
		popout.style.overflowY = 'auto';
		popout.style.display = 'none'; // Hidden by default
	
		// Add a header
		const header = document.createElement('h4');
		header.textContent = 'New Releases';
		header.style.marginTop = '0';
		popout.appendChild(header);
	
		// Iterate through each endpoint in the stashScenesMap
		Object.entries(stashScenesMap).forEach(([endpoint, stashData]) => {
			// Add a subheader for each source
			const sourceHeader = document.createElement('h5');
			const source = config.stashBoxes.find((ep) => ep.endpoint === endpoint);
			sourceHeader.textContent = source ? source.name : endpoint;
			sourceHeader.style.marginTop = '10px';
			sourceHeader.style.marginBottom = '5px';
			sourceHeader.style.fontSize = '16px';
			sourceHeader.style.borderBottom = '1px solid #444';
			popout.appendChild(sourceHeader);
	
			// Iterate through each stash_id's scenes
			Object.entries(stashData).forEach(([stashId, scenes]) => {
				if (!Array.isArray(scenes)) {
					console.warn(`Expected scenes to be an array but got:`, scenes);
	
					// If scenes is an object, wrap it in an array
					if (scenes && typeof scenes === 'object') {
						scenes = [scenes];
					} else {
						return; // Skip invalid scenes data
					}
				}
	
				scenes.forEach((scene) => {
					if (!scene || typeof scene !== 'object') {
						console.warn(`Invalid scene data:`, scene);
						return;
					}
	
					const sceneLink = document.createElement('a');
					sceneLink.href = generateSceneUrl(endpoint, scene.id); // Generate URL dynamically
					sceneLink.target = '_blank';
					sceneLink.rel = 'noopener noreferrer';
					sceneLink.style.textDecoration = 'none'; // Remove underline
					sceneLink.style.color = 'inherit'; // Inherit text color
	
					const sceneCard = document.createElement('div');
					sceneCard.style.display = 'flex';
					sceneCard.style.marginBottom = '10px';
					sceneCard.style.borderBottom = '1px solid #444';
					sceneCard.style.paddingBottom = '10px';
	
					const img = document.createElement('img');
					img.src = scene.images?.[0]?.url || '';
					img.alt = scene.title || 'Scene Preview';
					img.style.width = '60px';
					img.style.height = '60px';
					img.style.objectFit = 'cover';
					img.style.borderRadius = '4px';
					img.style.marginRight = '10px';
	
					const info = document.createElement('div');
					info.style.display = 'flex';
					info.style.flexDirection = 'column';
					info.style.justifyContent = 'center';
	
					const title = document.createElement('span');
					title.textContent = scene.title || 'Untitled Scene';
					title.style.fontWeight = 'bold';
					title.style.fontSize = '14px';
					title.style.color = '#fff';
	
					const date = document.createElement('span');
					date.textContent = `Released on: ${scene.release_date || 'Unknown'}`;
					date.style.fontSize = '12px';
					date.style.color = '#ccc';
	
					info.appendChild(title);
					info.appendChild(date);
					sceneCard.appendChild(img);
					sceneCard.appendChild(info);
					sceneLink.appendChild(sceneCard);
					popout.appendChild(sceneLink);
				});
			});
		});
	
		document.body.appendChild(popout);
	
		// Position the popout relative to the reference element (bell icon)
		const rect = referenceElement.getBoundingClientRect();
		popout.style.top = `${rect.bottom + window.scrollY + 10}px`; // 10px below the icon
		popout.style.left = `${rect.left + window.scrollX}px`; // Align to the left of the icon
	
		// Show the popout
		popout.style.display = 'block';
	
		// Event listeners to manage the popout visibility
		let hideTimeout = null;
	
		const hidePopout = () => {
			popout.style.display = 'none';
			popout.remove();
		};
	
		const handleMouseEnter = () => {
			clearTimeout(hideTimeout);
		};
	
		const handleMouseLeave = () => {
			hideTimeout = setTimeout(hidePopout, 200); // 200ms delay before hiding
		};
	
		// Attach mouseenter and mouseleave listeners to both popout and reference element
		popout.addEventListener('mouseenter', handleMouseEnter);
		popout.addEventListener('mouseleave', handleMouseLeave);
		referenceElement.addEventListener('mouseenter', handleMouseEnter);
		referenceElement.addEventListener('mouseleave', handleMouseLeave);
	
		return popout;
	};
	
	/**
	* Generate Scene URL Based on Endpoint
	*/
	const generateSceneUrl = (endpoint, stashId) => {
		if (endpoint.includes('pmvstash')) {
			return `https://pmvstash.org/scenes/${stashId}`;
		} else if (endpoint.includes('fansdb')) {
			return `https://fansdb.cc/scenes/${stashId}`;
		} else {
			return `https://stashdb.org/scenes/${stashId}`;
		}
	};

    /**
     * Add New Release Icon Positioned on the Lower Left Corner of the Performer Card Image
     */
    const addNewReleaseIcon = (card, stashMap, stashScenesMap) => {
        // Check if the bell icon already exists to prevent duplicates
        if (card.querySelector('.new-release-bell-icon')) {
            console.log("Bell icon already exists in this card. Skipping adding another.");
            return;
        }

        // Create the wrapper div with a class and unique ID
        const iconWrapper = document.createElement('div');
        // Create a unique identifier based on all stash IDs
        const uniqueId = Object.values(stashMap).join('-');
        iconWrapper.className = 'new-release-bell-icon-wrapper';
        iconWrapper.id = `new-release-bell-wrapper-${uniqueId}`;

        // Style the wrapper div for bottom-left placement
        iconWrapper.style.position = 'absolute';
        iconWrapper.style.bottom = '10px'; // Align to the bottom edge
        iconWrapper.style.left = '10px';   // Align to the left edge
        iconWrapper.style.zIndex = '10';    // Ensure it appears above other elements
        iconWrapper.style.cursor = 'pointer'; // Indicate interactivity

        // Create the <a> element with class and ID
        const iconContainer = document.createElement('a');
        // Construct the href by taking the first endpoint and stash_id
        const firstEndpoint = Object.keys(stashMap)[0];
        const firstStashId = stashMap[firstEndpoint];
        iconContainer.href = `${firstEndpoint}/performers/${firstStashId}`;
        iconContainer.target = '_blank';
        iconContainer.rel = 'noopener noreferrer';
        iconContainer.title = 'New Release Available!';
        iconContainer.className = 'new-release-bell-icon';
        iconContainer.id = `new-release-bell-${firstStashId}`;

        // Bell Icon SVG
        iconContainer.innerHTML = `
            <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="bell" 
                 class="svg-inline--fa fa-bell fa-icon" role="img" xmlns="http://www.w3.org/2000/svg" 
                 viewBox="0 0 448 512" style="color: gold; width: 24px; height: 24px;">
              <path fill="currentColor" d="M224 512c35.3 0 63.9-28.6 63.9-63.9H160.1c0 35.3 
                 28.6 63.9 63.9 63.9zm215.9-149.3c-19.2-20.9-55.5-52.5-55.5-154.7 
                 0-77.7-54.5-139.3-127.9-155.2V32c0-17.7-14.3-32-32-32s-32 
                 14.3-32 32v20.8C117.5 68.7 63 130.4 63 208c0 102.2-36.3 133.8-55.5 
                 154.7-6 6.6-9.5 15.2-9.5 24.3 0 18 14.6 32 32.6 32h415.7c18 0 
                 32.6-14 32.6-32 0-9.1-3.4-17.7-9.5-24.3z"/>
            </svg>
        `;

        // Append the icon to the wrapper
        iconWrapper.appendChild(iconContainer);

        // Find the thumbnail section of the card to append the icon
        const thumbnailSection = card.querySelector('.thumbnail-section');
        if (thumbnailSection) {
            console.log("Found .thumbnail-section:", thumbnailSection);

            // Ensure the thumbnail section is relatively positioned
            const computedStyle = window.getComputedStyle(thumbnailSection);
            if (computedStyle.position === 'static') {
                thumbnailSection.style.position = 'relative';
                console.log(".thumbnail-section was static, set to relative.");
            } else {
                console.log(".thumbnail-section already has position:", computedStyle.position);
            }

            // Append the iconWrapper to the thumbnailSection
            thumbnailSection.appendChild(iconWrapper);
            console.log("Bell icon wrapper appended to .thumbnail-section.");

            // Attach hover event listeners to the icon to show popout
            iconContainer.addEventListener('mouseenter', () => {
                console.log("Mouse entered bell icon. Creating popout.");
                createScenePreviewPopout(stashScenesMap, iconContainer);
            });

            // Note: The popout itself handles outside clicks to hide
        } else {
            console.warn("Could not find .thumbnail-section in the performer card.");
        }
    };

    /**
     * Keep track of processed performers to avoid duplicate queries
     */
    const processedPerformers = new Set();

    /**
     * Process Performer Cards with Batch Queries Across All StashBoxes
     */
    const processPerformerCards = debounce(async () => {
        console.log("processPerformerCards() called");

        // Introduce a delay before processing performer cards
        await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay

        const performerCards = document.querySelectorAll('.performer-card');
        if (!performerCards.length) {
            console.log("No performer cards found on this page.");
            return;
        }

        console.log(`Found ${performerCards.length} performer cards.`);

        // Collect performerIds that have not been processed
        const performerIds = [];
        performerCards.forEach(card => {
            const performerHref = card.querySelector('a')?.getAttribute('href');
            const performerId = performerHref?.match(/\/performers\/(\d+)/)?.[1];

            if (performerId && !processedPerformers.has(performerId)) {
                performerIds.push(performerId);
            }
        });

        if (performerIds.length === 0) {
            console.log("No new performers to process.");
            return;
        }

        console.log(`Processing ${performerIds.length} new performers.`);

        // Batch query to get stashIds for all performerIds across all stashBoxes
        const performerStashMap = await getPerformerStashIDs(performerIds);
        console.log("Performer to StashID map:", JSON.stringify(performerStashMap, null, 2));

        // Collect all stashIds across different endpoints
        const stashIds = [];
        Object.values(performerStashMap).forEach(stashObj => {
            Object.values(stashObj).forEach(stash_id => {
                stashIds.push(stash_id);
            });
        });

        if (stashIds.length === 0) {
            console.log("No stashIds found for the new performers.");
            return;
        }

        console.log(`Fetching new releases for ${stashIds.length} stashIds.`);

        // Batch query to get new releases from all associated stashBoxes
        const stashScenesMap = await getNewReleasesForStashIDs(performerStashMap);
        console.log("StashID to Scenes map:", JSON.stringify(stashScenesMap, null, 2));

        // Iterate through each performer and update the card if there are new releases
        for (const performerId of performerIds) {
            const stashMap = performerStashMap[performerId];
            if (!stashMap) continue;

            // Collect all stashIds across different endpoints for this performer
            const individualStashIds = Object.values(stashMap);
            if (individualStashIds.length === 0) continue;

            // Initialize per-performer stashScenesMap
            const performerStashScenesMap = {};

            // Aggregate scenes per endpoint
            Object.entries(stashScenesMap).forEach(([endpoint, stashData]) => {
                Object.entries(stashData).forEach(([stashId, scenes]) => {
                    if (individualStashIds.includes(stashId)) {
                        if (!performerStashScenesMap[endpoint]) {
                            performerStashScenesMap[endpoint] = [];
                        }
                        performerStashScenesMap[endpoint].push(...scenes);
                    }
                });
            });

            // Filter scenes by date
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - config.defaultDateRange);
            const filteredStashScenesMap = {};

            Object.entries(performerStashScenesMap).forEach(([endpoint, scenes]) => {
                const filteredScenes = scenes.filter(scene => new Date(scene.release_date) > cutoffDate);
                if (filteredScenes.length > 0) {
                    filteredStashScenesMap[endpoint] = filteredScenes;
                }
            });

            console.log(`Performer ID: ${performerId}, New Releases: ${Object.keys(filteredStashScenesMap).length}`);

            if (Object.keys(filteredStashScenesMap).length > 0) {
                // Find the corresponding card
                const card = Array.from(performerCards).find(card => {
                    const performerHref = card.querySelector('a')?.getAttribute('href');
                    const id = performerHref?.match(/\/performers\/(\d+)/)?.[1];
                    return id === performerId;
                });

                if (card) {
                    addNewReleaseIcon(card, stashMap, filteredStashScenesMap);
                }
            }

            // Mark performer as processed
            processedPerformers.add(performerId);
        }
    }, 300); // Debounce delay of 300ms

    /**
     * Modal for Setting New Release Date Range
     */
    const createModal = () => {
        const modalBackdrop = document.createElement('div');
        modalBackdrop.style.position = 'fixed';
        modalBackdrop.style.top = '0';
        modalBackdrop.style.left = '0';
        modalBackdrop.style.width = '100%';
        modalBackdrop.style.height = '100%';
        modalBackdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modalBackdrop.style.display = 'flex';
        modalBackdrop.style.justifyContent = 'center';
        modalBackdrop.style.alignItems = 'center';
        modalBackdrop.style.zIndex = '10000'; // Higher z-index to overlay everything
        modalBackdrop.style.visibility = 'hidden';
        modalBackdrop.style.opacity = '0';
        modalBackdrop.style.transition = 'opacity 0.3s ease';

        const modal = document.createElement('div');
        modal.style.backgroundColor = '#1e1e1e';
        modal.style.color = '#ccc';
        modal.style.padding = '20px';
        modal.style.borderRadius = '8px';
        modal.style.width = '300px';
        modal.style.maxWidth = '90%';
        modal.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
        modal.style.position = 'relative';

        const header = document.createElement('h2');
        header.textContent = 'Set New Release Date Range';
        header.style.marginTop = '0';
        header.style.marginBottom = '10px';
        header.style.color = '#fff';
        modal.appendChild(header);

        const body = document.createElement('div');
        body.innerHTML = `
            <p style="font-size:14px;">
                Enter the number of days to look back for new releases:
            </p>
            <input type="number" id="date-range-input" style="width:100%;padding:5px;" value="${config.defaultDateRange}" min="1" />
        `;
        modal.appendChild(body);

        const footer = document.createElement('div');
        footer.style.marginTop = '20px';
        footer.style.textAlign = 'right';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'btn btn-light';
        saveBtn.style.marginRight = '8px';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn btn-secondary';

        footer.appendChild(saveBtn);
        footer.appendChild(closeBtn);
        modal.appendChild(footer);
        modalBackdrop.appendChild(modal);
        document.body.appendChild(modalBackdrop);

        // Show and hide functions with fade-in/out
        const showModal = () => { 
            modalBackdrop.style.visibility = 'visible';
            requestAnimationFrame(() => {
                modalBackdrop.style.opacity = '1';
            });
        };
        const hideModal = () => { 
            modalBackdrop.style.opacity = '0';
            modalBackdrop.addEventListener('transitionend', () => {
                if (modalBackdrop.style.opacity === '0') {
                    modalBackdrop.style.visibility = 'hidden';
                }
            }, { once: true });
        };

        // Close modal when clicking outside the modal content
        modalBackdrop.addEventListener('click', (event) => {
            if (event.target === modalBackdrop) {
                hideModal();
            }
        });

        // Close modal when pressing the 'Escape' key
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                hideModal();
            }
        };
        document.addEventListener('keydown', handleEscape);

        closeBtn.addEventListener('click', hideModal);
        saveBtn.addEventListener('click', () => {
            const newRange = parseInt(document.getElementById('date-range-input').value, 10);
            if (isNaN(newRange) || newRange < 1) {
                alert("Please enter a valid number of days.");
                return;
            }
            localStorage.setItem('newReleaseDateRange', newRange);
            config.defaultDateRange = newRange;
            hideModal();
            // Re-process cards after changing date range
            processedPerformers.clear();
            processPerformerCards();
        });

        return { show: showModal, hide: hideModal };
    };

    /**
     * Add Navbar Icon to Open Modal
     */
    const addNavbarIcon = (modalInstance) => {
        const parent = document.querySelector('.navbar-buttons');
        if (!parent) {
            console.warn("Navbar buttons container not found.");
            return;
        }

        // Create the FA icon button
        const iconBtn = document.createElement('button');
        iconBtn.type = "button";
        iconBtn.className = "btn btn-icon btn-secondary"; // Apply styles to make it look seamless
        iconBtn.style.marginLeft = "8px";
        iconBtn.style.display = "flex";
        iconBtn.style.alignItems = "center";
        iconBtn.style.justifyContent = "center";
        iconBtn.style.width = "36px";
        iconBtn.style.height = "36px";
        iconBtn.style.borderRadius = "50%"; // Circular button for the icon
        iconBtn.style.backgroundColor = "#6c757d"; // Match btn-secondary color
        iconBtn.style.border = "none"; // Remove border

        // Add the FA icon
        iconBtn.innerHTML = `
            <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="calendar-day" 
                 class="svg-inline--fa fa-calendar-day fa-icon" role="img" xmlns="http://www.w3.org/2000/svg" 
                 viewBox="0 0 448 512" style="width: 20px; height: 20px; color: white;">
              <path fill="currentColor" d="M124 0c13.3 0 24 10.7 24 24v24h152V24c0-13.3 10.7-24 24-24s24 
              10.7 24 24v24h40c35.3 0 64 28.7 64 64v352c0 35.3-28.7 
              64-64 64H40c-35.3 0-64-28.7-64-64V112c0-35.3 28.7-64 
              64-64h40V24c0-13.3 10.7-24 24-24zm312 
              128H12v320c0 8.8 7.2 16 16 16h392c8.8 0 
              16-7.2 16-16V128zm-80 96c13.3 0 24 10.7 
              24 24v112c0 13.3-10.7 24-24 24H92c-13.3 
              0-24-10.7-24-24V248c0-13.3 10.7-24 
              24-24h264z"/>
            </svg>
        `;

        // Add click event to show the modal
        iconBtn.addEventListener('click', () => {
            modalInstance.show();
        });

        // Append the icon button to the navbar
        parent.appendChild(iconBtn);
        console.log("Navbar icon added successfully.");
    };

    /**
     * Initialize Navbar Observer
     */
    const initializeNavbarObserver = () => {
        console.log("Initializing navbar observer...");
        const observer = new MutationObserver(() => {
            const navbarButtons = document.querySelector('.navbar-buttons');
            if (navbarButtons) {
                console.log(".navbar-buttons found, disconnecting observer and adding FA icon.");
                observer.disconnect();
                const modalInstance = createModal();
                addNavbarIcon(modalInstance);
            } else {
                console.log(".navbar-buttons not found yet...");
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    };

    /**
     * Initialize Page Change Listener using PluginApi.Event
     */
    const initializePageChangeListener = () => {
        console.log("Initializing page change listener...");

        // Listen for page changes
        PluginApi.Event.addEventListener("stash:location", () => {
            console.log('Page changed, re-checking for performer page and cards...');
            const newPath = window.location.pathname;
            if (newPath.startsWith('/performers')) {
                console.log("On performers page, initializing performer card processing.");
                // Clear previously processed performers if navigating within performers
                processedPerformers.clear();
                // Use waitForElement to ensure performer cards are loaded
                waitForElement('.performer-card', () => {
                    console.log("Performer card detected, processing...");
                    processPerformerCards();
                });
            }
        });
    };

    /**
     * Initial Setup
     */
    await getAllStashBoxes(); // Retrieve all external stashBoxes excluding ThePornDB
    await getStashDBApiKey();  // Retrieve StashDB API key specifically
    initializeNavbarObserver();
    initializePageChangeListener();

    // Initial processing if already on the performers page
    if (window.location.pathname.startsWith('/performers')) {
        console.log("On performers page at initial load, processing performer cards.");
        waitForElement('.performer-card', () => {
            console.log("Performer card detected at initial load, processing...");
            processPerformerCards();
        });
    } else {
        console.log("Not on a performers page at initial load. Skipping performer card processing.");
    }

    console.log("New Release Tracker Plugin fully initialized");
})();
