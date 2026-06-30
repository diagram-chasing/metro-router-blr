# Methodology

Every single commute emits carbon. Some commutes more so than others. Over days, months and years, these seemingly small amounts of carbon add up. Climate change is not just a today problem, how much worse the problem becomes depends on our actions today. Our exhibition attempts to make the long term impact of commute patterns on climate change more perceptible.

On the map, the combined impact of all attendees commutes is shown in terms of the years of human life lost in the city. The baseline level of PM2.5 is taken from the [ACAG annual-mean PM2.5 surface](https://sites.wustl.edu/acag/surface-pm2-5/). On top of this baseline, the combined emissions across all commutes entered by today's attendees are overlayed. The resulting net pollution in each area of the city is used to calculate the localized reduction in human lifespan based on the [Air Quality Life Index (AQLI)](https://aqli.epic.uchicago.edu/) metric.

When you enter your commute, along with the above impact shown on the map, a receipt is printed that shows you the many ways your commute impacts the city.

The route between the start and end point of the commute is calculated using a locally hosted [OpenTripPlanner](https://www.opentripplanner.org/) instance. [OpenStreetMap](https://openstreetmap.in) is used for the base road network, along with GTFS datasets for the [bus system operated by BMTC](https://github.com/Vonter/bmtc-gtfs) and [Namma Metro operated by BMRCL](https://github.com/Vonter/bmrcl-gtfs), to calculate potential journeys using different modes of transport. The total distance covered in a year is calculated based on this single commute distance, and the frequency of the commute.

Your commute preference is compared with the average commuter in the same area of the city. The commute modal share and daily commute volume in the area are based on traffic surveys from:
- [Comprehensive Mobility Plan for Bengaluru, 2019 prepared by the Directorate of Urban Land Transport, Government of Karnataka](https://data.opencity.in/dataset/1e5b4cad-bb95-4d95-b878-cbb6d9013feb/resource/0f3c3f41-ed17-4c16-94c4-e2269918586c/download/4b639b61-9e90-4e62-80df-b7bb2c2aa45a.pdf)
- [Comprehensive Traffic and Transportation Plan for Bengaluru, 2011 prepared by RITES](https://data.opencity.in/dataset/e1895867-b2e4-448c-9df0-364b5ec58c11/resource/0a21e3f2-3830-4c0f-86f1-4a60d9fa5ae9/download/76c7d21a-fddf-42a4-b16a-f9f8079dfd06.pdf)

Numbers for per-km emissions of CO2 for each vehicle type are taken from the [e-AMRIT CO2 Emissions Calculator](https://e-amrit.niti.gov.in/co2-calculator). The existing EV adoption rate of the city is used to arrive at an average per-km emission across a combined fleet of carbon emitting petrol/diesel vehicles and non-carbon emitting electric vehicles, based on results found in [Bengaluru 2030: EV charging demand and infrastructure](https://cstep.in/publication/bengaluru-2030-ev-charging-demand-and-infrastructure/) and [CO2 Baseline Database for the Indian Power Sector](https://cea.nic.in/wp-content/uploads/baseline/2025/12/User_Guide_V_21.0.pdf). The carbon emissions per-km and the total commute distance per day combine to give the total CO2 emissions for the day. Daily commute emisssions are added over one year to arrive at an annual emissions amount. The CO2 equivalents for trees and gas cylinders are used to show the annual emissions in comparison to common physical objects.

Based on the route plan calculated by OpenTripPlanner over various modes of transport, the commute emissions for each possible mode of transport are shown. The most relevant and frequent metro, AC bus and normal bus routes that overlap with the selected commute are shown, along with how much annual reduction in emissions could be achieved by switching from one mode to another.

The negative externalities of cars extend beyond carbon emissions. In Bangalore (as of July 2026), there is a planned parking charge of [80 rupees per hour on certain streets](https://www.deccanherald.com/india/karnataka/bengaluru/give-vacant-land-for-parking-space-in-bengaluru-get-tax-waiver-4056592), but until implemented, expensive real estate is given away for free to blocks of metal on the road. The government notified guidance value for land in each area is taken from the [Kaveri portal maintained by the Department of Stamps and Registration, Government of Karnataka](https://kaveri.karnataka.gov.in/guest-valuation). The value of 1 sq.m. of land is used to calculate the equivalent value of land on which 1 parked car stands. The area taken by 1 parked car is based on the minimum car parking space requirements as per the [Bangalore Mahanagara Palike Building Bye-Laws, 2003](https://data.opencity.in/dataset/d7ebf3ea-faea-4d6b-ad20-7b2ff328ad3b/resource/5674a632-ffd5-4636-9804-89c52f0c631a/download/a84859f3-21d4-4d77-9100-b8004bb94899.pdf)

The number of cars added to the city each day is based on the [vehicle registrations data from the Parivesh portal](https://github.com/Vonter/india-vehicle-stats).

## Data Sources

- Emissions, PM2.5 and AQLI:
  - e-AMRIT CO2 Emissions Calculator: https://e-amrit.niti.gov.in/co2-calculator
  - Bengaluru 2030: EV charging demand and infrastructure: https://cstep.in/publication/bengaluru-2030-ev-charging-demand-and-infrastructure/
  - CO2 Baseline Database for the Indian Power Sector: https://cea.nic.in/wp-content/uploads/baseline/2025/12/User_Guide_V_21.0.pdf 
  - Annual mean PM2.5, Atmospheric Composition Analysis Group, Washington University in St. Louis: https://sites.wustl.edu/acag/surface-pm2-5/
  - Air Quality Life Index (AQLI), Energy Policy Institute, University of Chicago: https://aqli.epic.uchicago.edu/
- Commute Routing:
  - OpenStreetMap: https://openstreetmap.in
  - BMTC GTFS: https://github.com/Vonter/bmtc-gtfs
  - BMRCL GTFS: https://github.com/Vonter/bmrcl-gtfs
- Traffic Volumes
  - Comprehensive Mobility Plan for Bengaluru, 2019 prepared by the Directorate of Urban Land Transport, Government of Karnataka: https://data.opencity.in/dataset/1e5b4cad-bb95-4d95-b878-cbb6d9013feb/resource/0f3c3f41-ed17-4c16-94c4-e2269918586c/download/4b639b61-9e90-4e62-80df-b7bb2c2aa45a.pdf
  - Comprehensive Traffic and Transportation Plan for Bengaluru, 2011 prepared by RITES: https://data.opencity.in/dataset/e1895867-b2e4-448c-9df0-364b5ec58c11/resource/0a21e3f2-3830-4c0f-86f1-4a60d9fa5ae9/download/76c7d21a-fddf-42a4-b16a-f9f8079dfd06.pdf
- Parking
  - Guidance Value, Department of Stamps and Registration, Government of Karnataka: https://kaveri.karnataka.gov.in/guest-valuation
  - Bangalore Mahanagara Palike Building Bye-Laws, 2003: https://data.opencity.in/dataset/d7ebf3ea-faea-4d6b-ad20-7b2ff328ad3b/resource/5674a632-ffd5-4636-9804-89c52f0c631a/download/a84859f3-21d4-4d77-9100-b8004bb94899.pdf
- Other:
  - Vehicle Registrations: https://github.com/Vonter/india-vehicle-stats

## Caveats

- Emissions, PM2.5 and AQLI:
  - The baseline PM2.5 used on the map is a satellite derived dataset, it is limited both in terms of spatial granularity and accuracy, due to reliance on remotely sensed data instead of on-ground observations. The numbers shown may not accurately represent the reality at every location within the area.
  - The emissions from a vehicle can vary greatly depending on whether it is an EV, how much it complies with emissions norms, the road conditions under which it is operated, and more. A single number is used for modelling the overall emissions but may not accurately represent the emissions from your specific vehicle or commute.
  - While EVs have zero emissions in the city, the source of electricity could be anything from a solar farm, nuclear reactor to a thermal power plant. The true emissions from the energy powering the vehicle could be dirtier than an equivalent diesel vehicle, depending on the source of electricity production. The manufacturing of the vehicle itself has it's own additional emissions.
  - Pollution from vehicles and traffic is only one of many sources of pollution in the city. The baseline PM2.5 shown is caused by all these sources of pollution, not exclusively from vehicle emissions.
  - On average a bus or metro emits less than an equivalent car trip, but an EV car charged using solar would have massively lower emissions than a diesel bus that should have been scrapped 5 years ago.
- Commute Routing:
  - Routing on bus and metro is calculated based on timetables published by the respective authorities. Due to various factors, timetables are not followed in practice, and the suggested journey may not always be the best choice.
  - For transit commutes involving transfers or interchanges, the time taken for the transfer may not be accurately represented.
  - The hassle of using public transport in terms of unmaintained, unreliabile, unfriendly supporting environments have not been factored into the commute routing calculation.
  - As there is no open dataset of live traffic conditions, and the existing monopoly hoards your data without publishing any open data, traffic conditions are not included in the commute routing calculation.
- Traffic Volumes:
  - The traffic surveys used in the analysis were all conducted pre-COVID. Since then, there have been major changes in commute patterns, from increased metro network connectivity, a growing population, and most importantly, from much higher vehicle ownership rates. A basic multiplier factor has been used to model the growth in traffic volume, but may not be representative of actual traffic pattern changes.
  - Only major roads and junctions have recorded traffic surveys. As a result, traffic volume on each journey is modelled on the basis of these major roads or junctions through which it passes.
  - As there is no open dataset of traffic patterns or traffic volumes, and the existing monopoly hoards your data without publishing any open data, granular street and time specific traffic volumes are not modeled.
- Parking:
  - Guidance values notified by the government are not truly representative to begin with, and are sometimes set at a particular amount for political reasons. However, the value generally correlates with the cost of an area relative to the rest of the city.
  - Area level guidance values have been used to established the value of land in each location. In reality, the value of land varies by plot and street. As a result, the value of land shown may not match the exact location where the car or end point is, but is meant to represent an average value in the general area.
  - Various other negative externalities have not been considered, such as cars parked in places where they should not be, like blocking the driveway of a house or blocking an entire 5 metre wide footpath. 
- Other:
  - Only vehicles registered in an RTO within the Bengaluru metropolitan area are included in the daily vehicle registration count. The actual number of vehicles in the city is higher than this number as vehicles from the rest of Karnataka and other states form a significant percentage of vehicles on the road.
