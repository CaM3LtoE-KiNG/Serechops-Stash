(async function () {
  'use strict';

  // Initial configuration object with default values
  const config = {
    serverUrl: `/graphql`, // Relative URL for local GraphQL endpoint
    localApiKey: '', // Will be updated after fetching configuration
    stashDBApiKey: '',
    stashDBEndpoint: 'https://stashdb.org/graphql',
    tpdbApiKey: '',
    tpdbEndpoint: '',
    fansdbApiKey: '',
    fansdbEndpoint: 'https://fansdb.cc/graphql',
  };

  // Function to fetch configuration for StashDB and TPDB
  async function fetchConfiguration() {
    const configQuery = `
			query Configuration {
				configuration {
					general {
						stashBoxes {
							endpoint
							api_key
							name
						}
						apiKey
					}
				}
			}
		`;

    try {
      // Correctly pass query and variables to graphqlRequest
      const response = await graphqlRequest(configQuery);
      if (response && response.data && response.data.configuration) {
        return {
          stashBoxes: response.data.configuration.general.stashBoxes,
          localApiKey: response.data.configuration.general.apiKey,
        };
      } else {
        console.error('Failed to fetch configuration');
        return {
          stashBoxes: [],
          localApiKey: '',
        };
      }
    } catch (error) {
      console.error('Error fetching configuration:', error);
      return {
        stashBoxes: [],
        localApiKey: '',
      };
    }
  }

  // Fetch the configuration for StashDB and TPDB
  const configData = await fetchConfiguration();
  const stashBoxes = configData.stashBoxes;
  const stashDBConfig = stashBoxes.find(
    (box) => box.endpoint === config.stashDBEndpoint
  );
  const tpdbConfig = stashBoxes.find((box) =>
    box.endpoint.startsWith('https://theporndb.net/graphql')
  ); // support ?type=Movie
  const fansdbConfig = stashBoxes.find(
    (box) =>
      box.endpoint === config.fansdbEndpoint ||
      box.endpoint === 'https://fansdb.xyz/graphql'
  ); // support old FansDB domain

  // Update the configuration object with fetched data if undefined
  config.localApiKey = configData?.localApiKey ?? '';
  config.stashDBApiKey = stashDBConfig?.api_key ?? '';
  config.tpdbApiKey = tpdbConfig?.api_key ?? '';
  config.tpdbEndpoint = tpdbConfig?.endpoint ?? '';
  config.fansdbEndpoint = fansdbConfig?.endpoint ?? '';
  config.fansdbApiKey = fansdbConfig?.api_key ?? '';

  const spinnerHTML = `<div id="performers-loading-spinner"><img src=""></div>`;
  const dimOverlayHTML = `<div id="performers-dim-overlay"></div>`;
  document.body.insertAdjacentHTML('beforeend', spinnerHTML);
  document.body.insertAdjacentHTML('beforeend', dimOverlayHTML);

  let slideshowInterval;

  function startSlideshow(images) {
    const spinner = document.getElementById('performers-loading-spinner');
    let currentIndex = 0;

    function showNextImage() {
      if (currentIndex >= images.length) {
        currentIndex = 0;
      }
      const imgHTML = `<img src="${images[currentIndex].url}" alt="Image">`;
      spinner.insertAdjacentHTML('afterbegin', imgHTML);
      const imgElement = spinner.querySelector('img');
      imgElement.addEventListener('animationend', () => {
        const allImages = spinner.querySelectorAll('img');
        if (allImages.length > 1) {
          allImages[1].remove();
        }
      });
      currentIndex++;
    }

    showNextImage();
    setInterval(showNextImage, 2000);
  }

  function showLoadingSpinner(images) {
    const spinner = document.getElementById('performers-loading-spinner');
    const dimOverlay = document.getElementById('performers-dim-overlay');
    if (spinner) {
      spinner.innerHTML =
        '<div class="performers-loading-header">Fetching Scenes...</div>';
      startSlideshow(images);
      spinner.style.display = 'block';
      dimOverlay.style.display = 'block';
    }
  }

  function hideLoadingSpinner() {
    const spinner = document.getElementById('performers-loading-spinner');
    const dimOverlay = document.getElementById('performers-dim-overlay');
    if (spinner) {
      clearInterval(slideshowInterval);
      spinner.style.display = 'none';
      dimOverlay.style.display = 'none';
    }
  }

  // Function to extract performer ID from the URL
  function getPerformerID(url) {
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1];
  }

  // Function to fetch performer IDs
  async function fetchPerformerIDs(performerID) {
    const query = `
			query FindPerformer($id: ID!) {
				findPerformer(id: $id) {
					stash_ids {
						endpoint
						stash_id
					}
				}
			}
		`;
    console.log("GraphQL query for fetching performer's IDs:", query);
    try {
      // Correct the order and content of the parameters
      const response = await graphqlRequest(query, { id: performerID });
      console.log("Response for performer's IDs:", response);
      if (response && response.data && response.data.findPerformer) {
        const stash_ids = response.data.findPerformer.stash_ids;
        return {
          stashDBID: stash_ids.find(
            (id) => id.endpoint === 'https://stashdb.org/graphql'
          )?.stash_id,
          tpdbID: stash_ids.find(
            (id) => id.endpoint === 'https://theporndb.net/graphql'
          )?.stash_id,
        };
      } else {
        console.error('No data found for performer:', performerID);
        return null;
      }
    } catch (error) {
      console.error('Error fetching performer IDs:', error);
      return null;
    }
  }

  // Function to fetch performer images from StashDB
  async function fetchPerformerImagesFromStashDB(performerStashID) {
    const query = `
            query FindPerformer($id: ID!) {
                findPerformer(id: $id) {
                    images {
                        url
                        width
                        height
                    }
                }
            }
        `;
    console.log(
      'GraphQL query for fetching performer images from StashDB:',
      query
    );
    try {
      const response = await gqlQuery(
        config.stashDBEndpoint,
        query,
        { id: performerStashID },
        config.stashDBApiKey
      );
      console.log('Response for performer images from StashDB:', response);
      if (response && response.data && response.data.findPerformer) {
        return response.data.findPerformer.images;
      } else {
        console.error(
          'No images found for performer in StashDB:',
          performerStashID
        );
        return [];
      }
    } catch (error) {
      console.error('Error fetching performer images from StashDB:', error);
      return [];
    }
  }

  // Function to fetch performer images from TPDB
  async function fetchPerformerImagesFromTPDB(performerTPDBID) {
    console.log('TPDB API Key before request:', config.tpdbApiKey);
    const query = `
            query FindPerformer($id: ID!) {
                findPerformer(id: $id) {
                    images {
                        url
                        width
                        height
                    }
                }
            }
        `;
    console.log(
      'GraphQL query for fetching performer images from TPDB:',
      query
    );
    try {
      const response = await gqlQuery(
        config.tpdbEndpoint,
        query,
        { id: performerTPDBID },
        config.tpdbApiKey
      );
      console.log('Response for performer images from TPDB:', response);
      if (response && response.data && response.data.findPerformer) {
        return response.data.findPerformer.images;
      } else {
        console.error(
          'No images found for performer in TPDB:',
          performerTPDBID
        );
        return [];
      }
    } catch (error) {
      console.error('Error fetching performer images from TPDB:', error);
      return [];
    }
  }

  // Function to fetch performer images from local server
  async function fetchPerformerImagesFromLocal(performerID) {
    const looseImagesQuery = `
            query FindLooseImages($performer_id: [ID!]!) {
                findImages(
                    image_filter: { performers: { value: $performer_id, modifier: INCLUDES } }
                    filter: { per_page: -1 }
                ) {
                    images {
                        id
                        files {
                            width
                            height
                        }
                        paths {
                            thumbnail
                        }
                    }
                }
            }
        `;

    const galleriesQuery = `
            query FindGalleries($performer_id: ID!) {
                findGalleries(
                    gallery_filter: { performers: { value: [$performer_id], modifier: INCLUDES } }
                    filter: { per_page: -1 }
                ) {
                    galleries {
                        id
                    }
                }
            }
        `;

    const galleryImagesQuery = `
            query FindGalleryImages($gallery_ids: [ID!]!) {
                findImages(
                    image_filter: { galleries: { value: $gallery_ids, modifier: INCLUDES } }
                    filter: { per_page: -1 }
                ) {
                    images {
                        id
                        files {
                            width
                            height
                        }
                        paths {
                            thumbnail
                        }
                    }
                }
            }
        `;

    console.log(
      'GraphQL query for fetching performer loose images:',
      looseImagesQuery
    );
    console.log(
      'GraphQL query for fetching performer galleries:',
      galleriesQuery
    );

    try {
      const looseImagesResponse = await graphqlRequest(
        looseImagesQuery,
        { performer_id: [performerID] },
        config.apiKey
      );
      const looseImages = looseImagesResponse.data.findImages.images;

      const galleriesResponse = await graphqlRequest(
        galleriesQuery,
        { performer_id: performerID },
        config.apiKey
      );
      const galleryIDs = galleriesResponse.data.findGalleries.galleries.map(
        (g) => g.id
      );

      if (galleryIDs.length > 0) {
        const galleryImagesResponse = await graphqlRequest(
          galleryImagesQuery,
          { gallery_ids: galleryIDs },
          config.apiKey
        );
        const galleryImages = galleryImagesResponse.data.findImages.images;

        return looseImages.concat(galleryImages);
      } else {
        return looseImages;
      }
    } catch (error) {
      console.error('Error fetching performer images from local:', error);
      return [];
    }
  }

  // Function to fetch performer details
  async function fetchPerformerDetails(performerID) {
    const query = `
			query FindPerformer($id: ID!) {
				findPerformer(id: $id) {
					id
					name
					scenes {
						title
						stash_ids {
							stash_id
						}
					}
				}
			}
		`;

    console.log('GraphQL query:', query);

    try {
      // Correct the order and content of the parameters
      const response = await graphqlRequest(query, { id: performerID });
      console.log('Response for performer details:', response);
      if (response && response.data && response.data.findPerformer) {
        return response.data.findPerformer;
      } else {
        console.error('No details found for performer:', performerID);
        return null;
      }
    } catch (error) {
      console.error('Error fetching performer details:', error);
      return null;
    }
  }

  // Function to fetch scenes from StashDB
  async function fetchStashDBScenes(stash_ids, page = 1) {
    const query = `
            query QueryScenes($stash_ids: [ID!]!, $page: Int!) {
                queryScenes(
                    input: {
                        performers: {
                            value: $stash_ids,
                            modifier: INCLUDES
                        },
                        per_page: 25,
                        page: $page
                    }
                ) {
                    scenes {
                        id
                        title
                        release_date
                        urls {
                            url
                        }
                        images {
                            url
                        }
                        studio {
                            name
                            urls {
                                url
                            }
                        }
                    }
                    count
                }
            }
        `;
    console.log('GraphQL query for fetching StashDB scenes:', query);
    try {
      const response = await gqlQuery(
        config.stashDBEndpoint,
        query,
        { stash_ids, page },
        config.stashDBApiKey
      );
      console.log('Response for StashDB scenes:', response);
      if (response && response.data && response.data.queryScenes) {
        return response.data.queryScenes;
      } else {
        console.error('No scenes found for performer:', stash_ids);
        return null;
      }
    } catch (error) {
      console.error('Error fetching scenes from StashDB:', error);
      return null;
    }
  }

  // Function to compare local and StashDB scenes
  function compareScenes(localScenes, stashDBScenes) {
    const localSceneTitles = new Set(localScenes.map((scene) => scene.title));
    const stashDBSceneTitles = new Set(
      stashDBScenes.map((scene) => scene.title)
    );
    const missingScenes = stashDBScenes.filter(
      (scene) => !localSceneTitles.has(scene.title)
    );
    return missingScenes;
  }

  // Function to create the missing scenes modal
  function createMissingScenesModal(missingScenes) {
    const totalScenes = missingScenes.length;
    let currentPage = 1;
    const scenesPerPage = 27;
    const totalPages = Math.ceil(totalScenes / scenesPerPage);

    function renderScenes(page) {
      const start = (page - 1) * scenesPerPage;
      const end = start + scenesPerPage;
      const scenesHTML = missingScenes
        .slice(start, end)
        .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))
        .map(
          (scene) => `
                <div class="performers-custom-scene-option" data-id="${
                  scene.id
                }">
                    <h3>${scene.title}</h3>
                    <img src="${scene.images[0]?.url || ''}" alt="${
            scene.title
          }">
                    <p>Release Date: ${scene.release_date}</p>
                    <p>Studio: ${scene.studio?.name || 'N/A'}</p>
                    ${
                      scene.studio?.urls?.[0]?.url
                        ? `<a href="${scene.studio.urls[0].url}" target="_blank">Visit the Studio</a>`
                        : ''
                    }
                    <a href="https://stashdb.org/scenes/${
                      scene.id
                    }" target="_blank">Find on StashDB</a>
                </div>
            `
        )
        .join('');
      document.getElementById('performers-custom-sceneGallery').innerHTML =
        scenesHTML;

      document.getElementById(
        'performers-custom-pagination-controls-scenes'
      ).innerHTML = `
                ${
                  page > 1
                    ? `<span class="performers-custom-page-link" data-page="${
                        page - 1
                      }">Previous</span>`
                    : ''
                }
                ${
                  page < totalPages
                    ? `<span class="performers-custom-page-link" data-page="${
                        page + 1
                      }">Next</span>`
                    : ''
                }
            `;

      document
        .querySelectorAll('.performers-custom-page-link')
        .forEach((link) => {
          link.onclick = function () {
            renderScenes(parseInt(link.getAttribute('data-page')));
          };
        });
    }

    const modalHTML = `
            <div id="performers-custom-missingScenesModal" class="performers-custom-modal">
                <div class="performers-custom-modal-content">
                    <span class="performers-custom-close">&times;</span>
                    <center><h2>Missing Scenes from StashDB</h2></center>
                    <div id="performers-custom-sceneGallery"></div>
                    <div id="performers-custom-pagination-controls-scenes"></div>
                </div>
            </div>
        `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    renderScenes(currentPage);

    const modal = document.getElementById(
      'performers-custom-missingScenesModal'
    );
    const span = document.getElementsByClassName('performers-custom-close')[0];
    span.onclick = function () {
      modal.style.display = 'none';
      modal.remove();
    };
    window.onclick = function (event) {
      if (event.target == modal) {
        modal.style.display = 'none';
        modal.remove();
      }
    };
  }

  // Function to create the image selection modal
  function createImageSelectionModal(
    images,
    performerID,
    performerName,
    source,
    onFinish
  ) {
    const totalImages = images.length;
    let currentPage = 1;
    const imagesPerPage = 40;
    const totalPages = Math.ceil(totalImages / imagesPerPage);

    function renderImages(page) {
      const start = (page - 1) * imagesPerPage;
      const end = start + imagesPerPage;
      const imageHTML = images
        .slice(start, end)
        .map(
          (img) => `
                <div class="performers-custom-image-option-container">
                    <img src="${
                      source === 'StashDB' || source === 'TPDB'
                        ? img.url
                        : img.paths.thumbnail
                    }" class="performers-custom-image-option" data-url="${
            source === 'StashDB' || source === 'TPDB'
              ? img.url
              : img.paths.thumbnail
          }">
                    ${
                      img.width && img.height && img.width > 0 && img.height > 0
                        ? `<div class="performers-image-dimensions">(${img.width} x ${img.height})</div>`
                        : ''
                    }
                </div>
            `
        )
        .join('');
      document.getElementById('performers-custom-imageGallery').innerHTML =
        imageHTML;

      document
        .querySelectorAll('.performers-custom-image-option')
        .forEach((img) => {
          img.onclick = function () {
            document
              .querySelectorAll('.performers-custom-image-option')
              .forEach((img) => img.classList.remove('selected'));
            img.classList.add('selected');
          };
        });

      document.getElementById(
        'performers-custom-pagination-controls'
      ).innerHTML = `
                ${
                  page > 1
                    ? `<span class="performers-custom-page-link" data-page="${
                        page - 1
                      }">Previous</span>`
                    : ''
                }
                ${
                  page < totalPages
                    ? `<span class="performers-custom-page-link" data-page="${
                        page + 1
                      }">Next</span>`
                    : ''
                }
            `;

      document
        .querySelectorAll('.performers-custom-page-link')
        .forEach((link) => {
          link.onclick = function () {
            renderImages(parseInt(link.getAttribute('data-page')));
          };
        });
    }

    const modalHTML = `
            <div id="performers-custom-imageSelectionModal" class="performers-custom-modal">
                <div class="performers-custom-modal-content">
                    <span class="performers-custom-close">&times;</span>
                    <center><h2>${source} Performer Images</h2></center>
                    <center><h3>${performerName}</h3></center>
                    <div id="performers-custom-imageGallery"></div>
                    <div id="performers-custom-pagination-controls"></div>
                    <button id="performers-custom-applyImage">Apply</button>
                </div>
            </div>
        `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    renderImages(currentPage);

    const modal = document.getElementById(
      'performers-custom-imageSelectionModal'
    );
    const span = document.getElementsByClassName('performers-custom-close')[0];
    span.onclick = function () {
      modal.style.display = 'none';
      modal.remove();
      if (onFinish) onFinish();
    };
    window.onclick = function (event) {
      if (event.target == modal) {
        modal.style.display = 'none';
        modal.remove();
        if (onFinish) onFinish();
      }
    };

    document.getElementById('performers-custom-applyImage').onclick =
      async function () {
        const selectedImage = document.querySelector(
          '.performers-custom-image-option.selected'
        );
        if (selectedImage) {
          const imageUrl = selectedImage.getAttribute('data-url');
          const success = await updatePerformerImage(performerID, imageUrl);
          if (success) {
            updatePerformerImageInDOM(performerID, imageUrl);
            Toastify({
              text: 'Image updated successfully',
              backgroundColor: 'green',
              position: 'center',
              duration: 3000,
            }).showToast();
          } else {
            Toastify({
              text: 'Failed to update image',
              backgroundColor: 'red',
              position: 'center',
              duration: 3000,
            }).showToast();
          }
          modal.style.display = 'none';
          modal.remove();
          if (onFinish) onFinish();
        } else {
          Toastify({
            text: 'Please select an image',
            backgroundColor: 'orange',
            position: 'center',
            duration: 3000,
          }).showToast();
        }
      };
  }

  // Function to update performer image in the DOM
  function updatePerformerImageInDOM(performerID, imageUrl) {
    const performerCard = document.querySelector(
      `.performer-card a[href$="/performers/${performerID}"]`
    );
    if (performerCard) {
      const imgElement = performerCard.querySelector('img');
      if (imgElement) {
        imgElement.src = imageUrl;
      }
    }
  }

  // Function to update performer image
  async function updatePerformerImage(performerID, imageUrl) {
    const mutation = `
			mutation PerformerUpdate($id: ID!, $image: String!) {
				performerUpdate(input: { id: $id, image: $image }) {
					id
				}
			}
		`;
    console.log('GraphQL mutation for updating performer image:', mutation);
    console.log('Performer ID:', performerID, 'Image URL:', imageUrl); // Log for validation

    try {
      // Ensure the mutation is sent correctly with variables
      const response = await graphqlRequest(
        mutation,
        { id: performerID, image: imageUrl },
        config.localApiKey
      );
      console.log('Response for updating performer image:', response);
      if (response && response.data && response.data.performerUpdate) {
        return response.data.performerUpdate.id;
      } else {
        console.error('Failed to update performer image:', performerID);
        return null;
      }
    } catch (error) {
      console.error('Error updating performer image:', error);
      return null;
    }
  }

  // Function to auto-tag performer
  async function autoTagPerformer(performerID) {
    const mutation = `
            mutation MetadataAutoTag {
                metadataAutoTag(input: { performers: "${performerID}" })
            }
        `;
    console.log('GraphQL mutation for auto-tagging performer:', mutation);
    try {
      const response = await graphqlRequest(mutation, {}, config.apiKey);
      console.log('Response for auto-tagging performer:', response);
      if (response && response.data && response.data.metadataAutoTag) {
        Toastify({
          text: 'Auto-tagging completed successfully',
          backgroundColor: 'green',
          position: 'center',
          duration: 3000,
        }).showToast();
        return response.data.metadataAutoTag;
      } else {
        Toastify({
          text: 'Failed to auto-tag performer',
          backgroundColor: 'red',
          position: 'center',
          duration: 3000,
        }).showToast();
        return null;
      }
    } catch (error) {
      Toastify({
        text: 'Error auto-tagging performer',
        backgroundColor: 'red',
        position: 'center',
        duration: 3000,
      }).showToast();
      console.error('Error auto-tagging performer:', error);
      return null;
    }
  }

  // Function to fetch tags matching a query using client-side regex filtering
  async function fetchTags(query) {
    // Create a regex pattern from the query to match tags
    const regex = new RegExp(query.split(/\s+/).join('.*'), 'i');

    const queryText = `
        query FindTags {
            findTags(filter: { per_page: -1 }) {
                tags {
                    id
                    name
                }
            }
        }
        `;

    try {
      const response = await fetch(config.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${config.apiKey}`,
        },
        body: JSON.stringify({ query: queryText }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error(
          `GraphQL error: ${result.errors.map((e) => e.message).join(', ')}`
        );
      }

      // Filter the tags on the client side using the regex
      const filteredTags = result.data.findTags.tags.filter((tag) =>
        regex.test(tag.name)
      );

      return filteredTags;
    } catch (error) {
      console.error('Error fetching tags:', error);
      return [];
    }
  }

  // Function to create the Tabulator table in a popup for tag selection
  function createTagTabulatorPopup(performerID) {
    console.log(`Creating Tabulator popup for Tags`);
    const popup = document.createElement('div');
    popup.id = 'performers-tag-popup';
    document.body.appendChild(popup);

    const form = document.createElement('form');
    form.innerHTML = `
            <div id="performers-tag-close" class="performers-tag-close">&times;</div>
            <h2>Select Tags for Performer</h2>
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    <input type="text" id="performers-tag-search" placeholder="Search Tags">
                    <div id="performers-tag-table"></div>
                </div>
                <div style="flex: 1;">
                    <h3>Recent Tags</h3>
                    <div id="performers-recent-tags"></div>
                </div>
            </div>
            <button type="button" id="performers-apply-tags">Apply Tags</button>
        `;
    popup.appendChild(form);

    // Close button logic
    document.getElementById('performers-tag-close').onclick = function () {
      popup.remove();
    };

    const tableColumns = [
      { title: 'ID', field: 'id' },
      { title: 'Name', field: 'name' },
    ];

    const table = new Tabulator(`#performers-tag-table`, {
      layout: 'fitColumns',
      height: '300px',
      placeholder: 'No Tags Available',
      selectable: true,
      columns: tableColumns,
    });

    async function fetchData(query) {
      const data = await fetchTags(query);
      table.setData(data);
    }

    // Function to get the current timestamp in ISO format
    function getCurrentTimestamp() {
      return new Date().toISOString();
    }

    // Fetch recent tags used for performers and display them
    async function fetchRecentTags() {
      const currentTimestamp = getCurrentTimestamp();

      const recentTagsQuery = `
                query FindPerformers {
                    findPerformers(
                        performer_filter: { updated_at: { value: "${currentTimestamp}", modifier: LESS_THAN } }
                        filter: { per_page: -1 }
                    ) {
                        performers {
                            id
                            name
                            tags {
                                id
                                name
                                updated_at
                            }
                        }
                    }
                }
            `;

      try {
        const response = await graphqlRequest(recentTagsQuery);

        // Log the entire response to understand what is returned
        console.log('Response from server:', response);

        // Check if the response contains the expected structure
        if (
          response &&
          response.data &&
          response.data.findPerformers &&
          Array.isArray(response.data.findPerformers.performers)
        ) {
          const performers = response.data.findPerformers.performers;

          // Extract tags from performers, remove duplicates, sort them by updated_at, and limit to the most recent 10 tags
          const uniqueTags = {};
          performers
            .flatMap((performer) => performer.tags)
            .forEach((tag) => {
              if (!uniqueTags[tag.id]) {
                uniqueTags[tag.id] = tag;
              }
            });

          // Convert the unique tags object back to an array and sort by updated_at
          const sortedTags = Object.values(uniqueTags)
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 10); // Take the most recent 10 tags

          const recentTagsContainer = document.getElementById(
            'performers-recent-tags'
          );

          // Check if there are any tags to display
          if (sortedTags.length > 0) {
            recentTagsContainer.innerHTML = sortedTags
              .map(
                (tag) =>
                  `<div class="recent-tag" data-tag-id="${tag.id}">${tag.name}</div>`
              )
              .join('');

            // Add event listeners to each tag for selection
            document.querySelectorAll('.recent-tag').forEach((tagElement) => {
              tagElement.addEventListener('click', function () {
                tagElement.classList.toggle('selected');
              });
            });
          } else {
            recentTagsContainer.innerHTML = `<div>No Recent Tags Found</div>`;
          }
        } else {
          // Handle cases where the structure is not as expected or no performers are returned
          console.warn(
            'Unexpected response structure or no performers found:',
            response
          );
          document.getElementById(
            'performers-recent-tags'
          ).innerHTML = `<div>No Recent Tags Found</div>`;
        }
      } catch (error) {
        // Log the error for debugging
        console.error('Error fetching recent tags:', error);

        // Display an error message to the user
        document.getElementById(
          'performers-recent-tags'
        ).innerHTML = `<div>Error fetching recent tags</div>`;
      }
    }

    fetchRecentTags();

    // Debounce function to limit the rate at which a function can fire
    function debounce(func, wait) {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    // Add input field for filtering
    const filterInput = document.getElementById(`performers-tag-search`);
    filterInput.addEventListener(
      'input',
      debounce((e) => {
        const query = e.target.value;
        fetchData(query);
      }, 300)
    );

    document
      .getElementById(`performers-apply-tags`)
      .addEventListener('click', async function () {
        const selectedRows = table.getSelectedData();
        const selectedIds = selectedRows.map((row) => row.id);

        // Get selected recent tags
        const selectedRecentTags = Array.from(
          document.querySelectorAll('.recent-tag.selected')
        ).map((tag) => tag.getAttribute('data-tag-id'));

        // Combine selected table tags and recent tags
        const combinedTagIds = Array.from(
          new Set([...selectedIds, ...selectedRecentTags])
        );

        if (combinedTagIds.length > 0) {
          const success = await addTagsToPerformer(performerID, combinedTagIds);
          if (success) {
            Toastify({
              text: 'Tags added successfully',
              backgroundColor: 'green',
              position: 'center',
              duration: 3000,
            }).showToast();
          } else {
            Toastify({
              text: 'Failed to add tags',
              backgroundColor: 'red',
              position: 'center',
              duration: 3000,
            }).showToast();
          }
          popup.remove();
        } else {
          Toastify({
            text: 'Please select at least one tag',
            backgroundColor: 'orange',
            position: 'center',
            duration: 3000,
          }).showToast();
        }
      });

    // Position the popup appropriately directly under the right-click menu
    const rect = currentMenu.getBoundingClientRect();
    popup.style.top = `${rect.bottom}px`;
    popup.style.left = `${rect.left}px`;
  }

  // Function to add tags to a performer
  async function addTagsToPerformer(performerID, newTagIds) {
    // First, fetch existing tags for the performer
    const existingTagsQuery = `
            query FindPerformer($id: ID!) {
                findPerformer(id: $id) {
                    tags {
                        id
                    }
                }
            }
        `;

    const existingTagsResponse = await graphqlRequest(
      existingTagsQuery,
      { id: performerID },
      config.apiKey
    );
    const existingTags = existingTagsResponse.data.findPerformer.tags.map(
      (tag) => tag.id
    );

    // Combine existing tags with new tags, ensuring no duplicates
    const combinedTagIds = Array.from(new Set([...existingTags, ...newTagIds]));

    // Mutation to update the performer with the combined tags
    const mutation = `
            mutation PerformerUpdate($id: ID!, $tag_ids: [ID!]) {
                performerUpdate(input: { id: $id, tag_ids: $tag_ids }) {
                    id
                }
            }
        `;

    try {
      const response = await graphqlRequest(
        mutation,
        { id: performerID, tag_ids: combinedTagIds },
        config.apiKey
      );
      console.log('Response for adding tags to performer:', response);
      return response && response.data && response.data.performerUpdate;
    } catch (error) {
      console.error('Error adding tags to performer:', error);
      return null;
    }
  }

  // Function to create the custom menu
  function createCustomMenu(performerID) {
    const menu = document.createElement('div');
    menu.id = 'performers-custom-menu';

    const missingScenesLink = document.createElement('a');
    missingScenesLink.href = '#';
    missingScenesLink.textContent = 'Missing Scenes';
    missingScenesLink.addEventListener('click', async function (e) {
      e.preventDefault();
      const performerIDs = await fetchPerformerIDs(performerID);
      if (performerIDs && performerIDs.stashDBID) {
        const images = await fetchPerformerImagesFromStashDB(
          performerIDs.stashDBID
        );
        showLoadingSpinner(images);
        const localDetails = await fetchPerformerDetails(performerID);
        const stashDBScenes = [];
        let page = 1;
        while (true) {
          const result = await fetchStashDBScenes(
            [performerIDs.stashDBID],
            page
          );
          stashDBScenes.push(...result.scenes);
          if (stashDBScenes.length >= result.count || result.scenes.length < 25)
            break;
          page++;
        }
        if (localDetails && stashDBScenes) {
          const missingScenes = compareScenes(
            localDetails.scenes,
            stashDBScenes
          );
          createMissingScenesModal(missingScenes);
          document.getElementById(
            'performers-custom-missingScenesModal'
          ).style.display = 'block';
        } else {
          console.error('Failed to fetch performer details or StashDB scenes');
        }
        hideLoadingSpinner();
      } else {
        console.error('Failed to fetch performer StashDB ID');
      }
    });
    menu.appendChild(missingScenesLink);

    const changeImageLink = document.createElement('a');
    changeImageLink.href = '#';
    changeImageLink.textContent = 'Change Image from StashDB...';
    changeImageLink.addEventListener('click', async function (e) {
      e.preventDefault();
      const performerIDs = await fetchPerformerIDs(performerID);
      const performerDetails = await fetchPerformerDetails(performerID);
      const performerName = performerDetails
        ? performerDetails.name
        : 'Unknown';
      if (performerIDs && performerIDs.stashDBID) {
        const images = await fetchPerformerImagesFromStashDB(
          performerIDs.stashDBID
        );
        if (images && images.length > 0) {
          createImageSelectionModal(
            images,
            performerID,
            performerName,
            'StashDB'
          );
          document.getElementById(
            'performers-custom-imageSelectionModal'
          ).style.display = 'block';
        } else {
          console.error('No images found for performer');
        }
      } else {
        console.error('Failed to fetch performer StashDB ID');
      }
    });
    menu.appendChild(changeImageLink);

    const changeImageFromTPDBLink = document.createElement('a');
    changeImageFromTPDBLink.href = '#';
    changeImageFromTPDBLink.textContent = 'Change Image from TPDB...';
    changeImageFromTPDBLink.addEventListener('click', async function (e) {
      e.preventDefault();
      const performerIDs = await fetchPerformerIDs(performerID);
      const performerDetails = await fetchPerformerDetails(performerID);
      const performerName = performerDetails
        ? performerDetails.name
        : 'Unknown';
      if (performerIDs && performerIDs.tpdbID) {
        const images = await fetchPerformerImagesFromTPDB(performerIDs.tpdbID);
        if (images && images.length > 0) {
          createImageSelectionModal(images, performerID, performerName, 'TPDB');
          document.getElementById(
            'performers-custom-imageSelectionModal'
          ).style.display = 'block';
        } else {
          console.error('No images found for performer');
        }
      } else {
        console.error('Failed to fetch performer TPDB ID');
      }
    });
    menu.appendChild(changeImageFromTPDBLink);

    const changeImageFromGalleryLink = document.createElement('a');
    changeImageFromGalleryLink.href = '#';
    changeImageFromGalleryLink.textContent = 'Change Image from Gallery...';
    changeImageFromGalleryLink.addEventListener('click', async function (e) {
      e.preventDefault();
      const images = await fetchPerformerImagesFromLocal(performerID);
      const performerDetails = await fetchPerformerDetails(performerID);
      const performerName = performerDetails
        ? performerDetails.name
        : 'Unknown';
      if (images && images.length > 0) {
        createImageSelectionModal(
          images,
          performerID,
          performerName,
          'Gallery'
        );
        document.getElementById(
          'performers-custom-imageSelectionModal'
        ).style.display = 'block';
      } else {
        console.error('No images found for performer');
      }
    });
    menu.appendChild(changeImageFromGalleryLink);

    const autoTagLink = document.createElement('a');
    autoTagLink.href = '#';
    autoTagLink.textContent = 'Auto-Tag...';
    autoTagLink.addEventListener('click', async function (e) {
      e.preventDefault();
      await autoTagPerformer(performerID);
    });
    menu.appendChild(autoTagLink);

    const addTagLink = document.createElement('a');
    addTagLink.href = '#';
    addTagLink.textContent = 'Add Tags...';
    addTagLink.addEventListener('click', async function (e) {
      e.preventDefault();
      createTagTabulatorPopup(performerID);
    });
    menu.appendChild(addTagLink);

    const batchChangeImageLink = document.createElement('a');
    batchChangeImageLink.href = '#';
    batchChangeImageLink.textContent = 'Batch Change Image...';
    batchChangeImageLink.addEventListener('click', async function (e) {
      e.preventDefault();
      const selectedPerformers = getSelectedPerformers();
      if (selectedPerformers.length > 0) {
        let currentPerformerIndex = 0;
        async function processNextPerformer() {
          if (currentPerformerIndex < selectedPerformers.length) {
            const performerID = selectedPerformers[currentPerformerIndex];
            const performerDetails = await fetchPerformerDetails(performerID);
            const performerName = performerDetails
              ? performerDetails.name
              : 'Unknown';
            const performerIDs = await fetchPerformerIDs(performerID);
            if (performerIDs && performerIDs.stashDBID) {
              const images = await fetchPerformerImagesFromStashDB(
                performerIDs.stashDBID
              );
              if (images && images.length > 0) {
                createImageSelectionModal(
                  images,
                  performerID,
                  performerName,
                  'StashDB',
                  () => {
                    currentPerformerIndex++;
                    processNextPerformer();
                  }
                );
                document.getElementById(
                  'performers-custom-imageSelectionModal'
                ).style.display = 'block';
              } else {
                console.error('No images found for performer');
                currentPerformerIndex++;
                processNextPerformer();
              }
            } else {
              console.error('Failed to fetch performer StashDB ID');
              currentPerformerIndex++;
              processNextPerformer();
            }
          }
        }
        processNextPerformer();
      } else {
        Toastify({
          text: 'Please select performers',
          backgroundColor: 'orange',
          position: 'center',
          duration: 3000,
        }).showToast();
      }
    });
    menu.appendChild(batchChangeImageLink);

    // Add Support link at the bottom of the menu
    const supportLink = document.createElement('a');
    supportLink.href = 'https://www.patreon.com/serechops/membership';
    supportLink.textContent = 'Support';
    supportLink.target = '_blank'; // Open in a new tab
    supportLink.style.marginTop = '10px';
    supportLink.style.color = '#FFD700';
    menu.appendChild(supportLink);

    document.body.appendChild(menu);
    return menu;
  }

  // Function to get selected performers
  function getSelectedPerformers() {
    const selectedPerformers = [];
    document
      .querySelectorAll('.performer-card .card-check:checked')
      .forEach((checkbox) => {
        const performerCard = checkbox.closest('.performer-card');
        const performerLink = performerCard.querySelector('a');
        if (performerLink) {
          const performerID = getPerformerID(performerLink.href);
          if (performerID) {
            selectedPerformers.push(performerID);
          }
        }
      });
    return selectedPerformers;
  }

  // Function to show the custom menu
  function showCustomMenu(event, performerID) {
    if (currentMenu) currentMenu.remove();
    const menu = createCustomMenu(performerID);
    menu.style.top = `${event.pageY}px`;
    menu.style.left = `${event.pageX}px`;
    event.preventDefault();

    const handleClickOutside = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        currentMenu = null;
        document.removeEventListener('click', handleClickOutside);
      }
    };

    document.addEventListener('click', handleClickOutside);
    currentMenu = menu;
  }

  // Function to extract performer ID from the current URL
  function getPerformerIDFromURL() {
    const url = window.location.href;
    const performerIDMatch = url.match(/\/performers\/(\d+)\//);
    return performerIDMatch ? performerIDMatch[1] : null;
  }

  // Function to handle right-click on performer cards or detail header image
  document.addEventListener('contextmenu', function (event) {
    // Check if the target is within a performer card or the detail header image
    const performerCard = event.target.closest('.performer-card');
    const performerImage = event.target.closest('.detail-header-image');

    let performerID;
    if (performerCard) {
      const performerLink = performerCard.querySelector('a');
      performerID = getPerformerID(performerLink.href);
    } else if (performerImage) {
      // If it's the detail header image, extract the ID from the current URL
      performerID = getPerformerIDFromURL();
    }

    if (performerID) {
      showCustomMenu(event, performerID);
    }
  });

  // Simplify graphqlRequest by removing the endpoint parameter
  async function graphqlRequest(query, variables = {}, apiKey = '') {
    const relativeUrl = '/graphql'; // Use the relative URL directly

    // Use the localApiKey if no apiKey is provided and ensure it is a string
    const effectiveApiKey =
      typeof apiKey === 'string' && apiKey.length > 0
        ? apiKey
        : config.localApiKey || '';

    console.log('Relative URL being used for the request:', relativeUrl);
    console.log('GraphQL query:', query);
    console.log('Variables:', variables);
    console.log('Effective API Key:', effectiveApiKey); // Log the effective API key

    try {
      // Create the headers object
      const headers = {
        'Content-Type': 'application/json',
      };

      // Include the API key only if it is defined and not empty
      if (effectiveApiKey) {
        headers['Apikey'] = effectiveApiKey;
      }

      const response = await fetch(relativeUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ query, variables }),
      });

      // Log the response status and headers
      console.log('Response Status:', response.status);
      console.log('Response Headers:', Array.from(response.headers.entries()));

      // Ensure response is valid JSON
      let jsonResponse;
      try {
        jsonResponse = await response.json();
        console.log('Parsed GraphQL response:', jsonResponse);
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        throw new Error('Failed to parse JSON response');
      }

      if (!response.ok) {
        console.error(
          'Error in GraphQL request:',
          response.status,
          response.statusText
        );
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      return jsonResponse;
    } catch (error) {
      console.error('Error fetching GraphQL data:', error);
      throw error;
    }
  }

  // Function to make GraphQL requests to a specific external endpoint (StashDB or TPDB)
  async function gqlQuery(endpoint, query, variables = {}, apiKey = '') {
    console.log('Making GraphQL request to endpoint:', endpoint);
    console.log('GraphQL query:', query);
    console.log('Variables:', variables);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Apikey: apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        console.error(
          'Error in GraphQL request:',
          response.status,
          response.statusText
        );
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const jsonResponse = await response.json();
      console.log('GraphQL response:', jsonResponse);
      return jsonResponse;
    } catch (error) {
      console.error('Error fetching GraphQL data:', error);
      throw error;
    }
  }

  // Store the currently opened right-click menu to close it if another right-click occurs
  let currentMenu = null;
})();
