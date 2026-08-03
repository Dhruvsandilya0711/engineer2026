const logo_image_wlc_page = document.querySelector("#logo-image-wlc-page")
const logo_text_wrapper_wlc_page = document.querySelector("#logo-text-wrapper-wlc-page")
const tablet_border_looping = document.querySelector("#tablet-border-looping")
const tabletBlackScreen = document.querySelector("#tabletBlackScreen")
const tablet_content_logo_text = document.querySelector("#tablet-content-logo-text")
const welcomePageWrapper = document.querySelector("#welcomePageWrapper")
const landingPageWrapper = document.querySelector("#landingPageWrapper")
const wlcPageLooping = document.querySelector("#wlcPageLooping")
const overlayWlcPageLooping = document.querySelector("#overlayWlcPageLooping")
const landingPageLoopingVideo = document.querySelector("#landingPageLoopingVideo")
const navbar = document.querySelector("#navbar")
const homeNavBar = document.querySelector("#homeNavBar")
const eventsNavBar = document.querySelector("#eventsNavBar")
const scheduleNavBar = document.querySelector("#scheduleNavBar")
const teamNavBar = document.querySelector("#teamNavBar")
const sponsorNavBar = document.querySelector("#sponsorNavBar")
const tabletDisplay = document.querySelector("#tablet-display")
const tabletDisplayContent = document.querySelector('#tablet-display-content')
const signInNavBtn = document.querySelector('#signInNavBtn')
const getStartedBtn = document.querySelector("#getStartedBtn")

//welcome page tablet screen turning on screen logic
const observer = new IntersectionObserver((enteries) => {
    enteries.forEach((entry) => {

        if (entry.isIntersecting) {


            tabletDisplayContent.classList.remove('opacity-0', 'pointer-events-none')
            tabletDisplayContent.classList.add('opacity-100', 'pointer-events-auto')
        } else {
            tabletDisplay.classList.remove('bg-white')
            tabletDisplay.classList.add('bg-neutral-900')


            tabletDisplayContent.classList.add('opacity-0', 'pointer-events-none')
            tabletDisplayContent.classList.remove('opacity-100', 'pointer-events-auto')
        }
    })
},
    {
        threshold: 0.7
    })


// observer.observe(tabletDisplay)


// navbar hover effects
navbar.addEventListener("mouseenter", () => {
    homeNavBar.children[1].classList.remove("hidden")
    eventsNavBar.children[1].classList.remove("hidden")
    scheduleNavBar.children[1].classList.remove("hidden")
    teamNavBar.children[1].classList.remove("hidden")
    sponsorNavBar.children[1].classList.remove("hidden")
    setTimeout(() => {
        homeNavBar.children[1].classList.remove("opacity-0", "hidden", "-translate-x-full")
        eventsNavBar.children[1].classList.remove("opacity-0", "hidden", "-translate-x-full")
        scheduleNavBar.children[1].classList.remove("opacity-0", "hidden", "-translate-x-full")
        teamNavBar.children[1].classList.remove("opacity-0", "hidden", "-translate-x-full")
        sponsorNavBar.children[1].classList.remove("opacity-0", "hidden", "-translate-x-full")
    }, 50);

})
navbar.addEventListener("mouseleave", () => {

    homeNavBar.children[1].classList.add("opacity-0", "hidden", "-translate-x-full")
    eventsNavBar.children[1].classList.add("opacity-0", "hidden", "-translate-x-full")
    scheduleNavBar.children[1].classList.add("opacity-0", "hidden", "-translate-x-full")
    teamNavBar.children[1].classList.add("opacity-0", "hidden", "-translate-x-full")
    sponsorNavBar.children[1].classList.add("opacity-0", "hidden", "-translate-x-full")
    setTimeout(() => {
        homeNavBar.children[1].classList.add("hidden")
        eventsNavBar.children[1].classList.add("hidden")
        scheduleNavBar.children[1].classList.add("hidden")
        teamNavBar.children[1].classList.add("hidden")
        sponsorNavBar.children[1].classList.add("hidden")
    }, 250);

})

// initial page reloading wlc page  animation effect 
function runIntroAnimation() {
    setTimeout(() => {
        logo_image_wlc_page.classList.remove("-translate-x-full")
        logo_text_wrapper_wlc_page.classList.remove("translate-x-full")


        // glitchy effect at the time of collision
        setTimeout(() => {
            logo_text_wrapper_wlc_page.classList.add("effect-glitch");
            logo_image_wlc_page.classList.add("effect-glitch");
            wlcPageLooping.classList.add("effect-glitch");
            overlayWlcPageLooping.classList.remove("opacity-0")
            overlayWlcPageLooping.classList.add("opacity-80")

            setTimeout(() => {
                logo_text_wrapper_wlc_page.classList.remove("effect-glitch");
                logo_image_wlc_page.classList.remove("effect-glitch");
                wlcPageLooping.classList.remove("effect-glitch");



            }, 300);

            tablet_content_logo_text.classList.add("opacity-0")
            welcomePageWrapper.classList.add("opacity-0")
            tabletBlackScreen.classList.add("scale-[4]")
            tablet_border_looping.classList.add("scale-[4]")
            tablet_content_logo_text.classList.add("scale-[4]")
            landingPageWrapper.classList.remove("hidden")
            setTimeout(() => {
                welcomePageWrapper.classList.add("hidden")


                landingPageWrapper.classList.remove("opacity-0")

            }, 700);


        }, 1000);



    }, 900);
}

if (document.prerendering) {
    document.addEventListener('prerenderingchange', runIntroAnimation, { once: true });
} else {
    runIntroAnimation();
}

 