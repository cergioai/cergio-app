// Per design-spec.md — add an hourly offering with name + rate.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';
// TaxonomyMatchBadge import removed — taxonomy is resolved silently
// in the background (still saves taxonomy_offering_id for routing)
// but no longer shown as a suggestion chip to the provider.
import { useTaxonomyResolve } from '../hooks/useTaxonomyResolve';

export function ServiceListAddOfferingScreen() {
  const navigate = useNavigate();
  const { addOffering, listingDraft } = useOutletContext();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [override, setOverride] = useState(false);

  // Resolve the offering name against the taxonomy. We seed with the
  // service-level taxonomy_provider_type so the resolver has a head start
  // — typing "drain unclog" under a provider already classified as a
  // Plumber should still map confidently.
  const { resolving, result, resolveNow } = useTaxonomyResolve(name);

  const valid = name.trim() && rate.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Add your hourly offering"
        sub="You may add as many offerings as you'd like"
        minHeight={400}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        <div className="mb-6">
          <label className="block text-heading-2 font-extrabold text-black mb-2.5">Offering name</label>
          <input
            type="text" value={name}
            onChange={e => { setName(e.target.value); setOverride(false); }}
            placeholder="Personal Training"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
          {/* Match badge hidden — provider's typed offering name is the
              source of truth. Taxonomy resolves silently for routing. */}
        </div>
        <div className="mb-6">
          <label className="block text-heading-2 font-extrabold text-black mb-2.5">Hourly rate</label>
          <input
            type="text" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="$50 per hour"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>
      </div>

      <RegFooter
        progress={0.35}
        onNext={async () => {
          const taxo = result ?? await resolveNow();
          const useTaxo = !override && taxo?.ok;
          addOffering({
            name:  name.trim(),
            kind:  'hourly',
            price: rate.trim(),
            taxonomy_offering_id: useTaxo ? (taxo.offering_id || null) : null,
            taxonomy_override:    !useTaxo,
          });
          navigate('/list-service/more-offerings');
        }}
        nextEnabled={valid}
      />
    </div>
  );
}
